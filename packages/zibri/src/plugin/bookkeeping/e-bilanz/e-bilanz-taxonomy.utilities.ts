import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { BookkeepingDayUtilities } from '../bookkeeping-day.utilities';
import { type EBilanzTaxonomyChange } from './models/e-bilanz-taxonomy-change.model';
import { type EBilanzTaxonomyColumnRow } from './models/e-bilanz-taxonomy-column-row.type';
import { type EBilanzTaxonomyPositionRow } from './models/e-bilanz-taxonomy-position-row.type';
import { type EBilanzTaxonomyPosition } from './models/e-bilanz-taxonomy-position.model';
import { type EBilanzStatementName, type EBilanzTaxonomyStatements } from './models/e-bilanz-taxonomy-statements.model';
import { type EBilanzTaxonomy } from './models/e-bilanz-taxonomy.model';
import { type EBilanzTaxonomyAdapterInterface } from './services/e-bilanz-taxonomy-adapter.interface';

/**
 * The statements of a taxonomy, in the order they are stated.
 */
const STATEMENT_NAMES: EBilanzStatementName[] = ['balanceSheet', 'incomeStatement', 'microIncomeStatement', 'appropriationOfProfits', 'businessAssetComparison'];

/**
 * The versions of the HGB taxonomy as data: resolves a version from the one before it and its positions from their
 * rows, picks the version of a fiscal year, and checks the versions registered.
 */
export abstract class EBilanzTaxonomyUtilities {
    // resolved once per version, as the positions of a version are read for every E-Bilanz stated in it
    private static readonly resolvedPositions: WeakMap<EBilanzTaxonomy, Map<string, EBilanzTaxonomyPosition>> = new WeakMap();

    /**
     * Resolves a version stated as what it changes of the version before it.
     * @param base - The version before it.
     * @param change - What it changes.
     * @returns The version.
     * @throws An InternalError for a change naming a position the version before does not have.
     */
    static resolveChanged(base: EBilanzTaxonomy, change: EBilanzTaxonomyChange): EBilanzTaxonomy {
        const statements: Record<EBilanzStatementName, EBilanzTaxonomyPositionRow[]> = {
            balanceSheet: [],
            incomeStatement: [],
            microIncomeStatement: [],
            appropriationOfProfits: [],
            businessAssetComparison: []
        };
        for (const name of STATEMENT_NAMES) {
            const { removed, rows } = change.statements[name];
            const changed: Set<string> = new Set(rows.map(r => r.row[0]));
            const res: EBilanzTaxonomyPositionRow[] = base.statements[name].filter(r => !removed.includes(r[0]) && !changed.has(r[0]));
            for (const { after, row } of rows) {
                const index: number = after == undefined ? -1 : res.findIndex(r => r[0] === after);
                if (after != undefined && index === -1) {
                    throw new InternalError(`The change of the taxonomy ${change.version} adds ${row[0]} after ${after}, which it does not have.`);
                }
                res.splice(index + 1, 0, row);
            }
            statements[name] = res;
        }
        return { ...change, statements };
    }

    /**
     * Resolves the positions of a version from their rows.
     * @param taxonomy - The version.
     * @returns Each position by its name, in the order of the statements.
     */
    static resolvePositions(taxonomy: EBilanzTaxonomy): Map<string, EBilanzTaxonomyPosition> {
        const known: Map<string, EBilanzTaxonomyPosition> | undefined = this.resolvedPositions.get(taxonomy);
        if (known != undefined) {
            return known;
        }
        const res: Map<string, EBilanzTaxonomyPosition> = new Map();
        for (const statement of STATEMENT_NAMES) {
            const rows: readonly EBilanzTaxonomyPositionRow[] = taxonomy.statements[statement];
            for (const [name, parent, balance, requirement, label, sums] of rows) {
                const parts: readonly string[] = sums ?? rows.filter(r => r[1] === name).map(r => r[0]);
                res.set(name, {
                    name,
                    statement,
                    parent,
                    balance: balance === 'D' ? 'debit' : 'credit',
                    requirement,
                    label,
                    sums: this.resolveSums(parts)
                });
            }
        }
        this.resolvedPositions.set(taxonomy, res);
        return res;
    }

    /**
     * Resolves the columns each column of the statement of changes in fixed assets of a version sums.
     * @param taxonomy - The version.
     * @returns The columns each sums, each with `1` or `-1`, by the name of the column, in the order of the version.
     */
    static resolveFixedAssetColumnSums(taxonomy: EBilanzTaxonomy): Map<string, EBilanzTaxonomyPosition['sums']> {
        const rows: readonly EBilanzTaxonomyColumnRow[] = taxonomy.fixedAssetColumns;
        return new Map(rows.map(([name, , , , sums]) => [name, this.resolveSums(sums ?? rows.filter(r => r[1] === name).map(r => r[0]))]));
    }

    /**
     * Finds the version a fiscal year is stated in: the one named, which needs to allow the fiscal year, or else the
     * latest one the fiscal year needs to be stated in.
     * @param taxonomies - The versions registered.
     * @param start - The first day of the fiscal year.
     * @param version - The version asked for, if any.
     * @returns The version, or undefined when none applies to the fiscal year.
     * @throws A ConflictError for a version asked for that is not registered or does not allow the fiscal year.
     */
    static findTaxonomy(taxonomies: readonly EBilanzTaxonomy[], start: Date, version?: string): EBilanzTaxonomy | undefined {
        if (version != undefined) {
            const named: EBilanzTaxonomy | undefined = taxonomies.find(t => t.version === version);
            const day: string = BookkeepingDayUtilities.formatDay(start);
            if (named == undefined) {
                throw new ConflictError($ts`The taxonomy ${version} of the E-Bilanz needs to be registered in ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES.`);
            }
            if (named.allowedFrom.getTime() > start.getTime()) {
                throw new ConflictError($ts`The taxonomy ${version} of the E-Bilanz applies to fiscal years starting on ${BookkeepingDayUtilities.formatDay(named.allowedFrom)} or later, and the fiscal year starts on ${day}.`);
            }
            return named;
        }
        // a version is mandatory for the fiscal years starting within a year from its day, until the version of the
        // next year is: a later fiscal year gets none rather than a version the tax administration may refuse
        return [...taxonomies]
            .filter(t => {
                const until: Date = new Date(t.mandatoryFrom);
                until.setUTCFullYear(until.getUTCFullYear() + 1);
                return t.mandatoryFrom.getTime() <= start.getTime() && start.getTime() < until.getTime();
            })
            .sort((a, b) => b.mandatoryFrom.getTime() - a.mandatoryFrom.getTime())
            .at(0);
    }

    /**
     * Validates the versions registered: each version once, an adapter of each, and every position each names below
     * or sums with is one of it.
     * @param taxonomies - The versions.
     * @param adapters - The adapters registered.
     * @throws An InternalError naming the first that does not hold.
     */
    static validateTaxonomies(taxonomies: readonly EBilanzTaxonomy[], adapters: readonly EBilanzTaxonomyAdapterInterface[]): void {
        const versions: string[] = taxonomies.map(t => t.version);
        const twice: string | undefined = versions.find((v, index) => versions.indexOf(v) !== index);
        if (twice != undefined) {
            throw new InternalError(`The taxonomy ${twice} of the E-Bilanz is registered twice.`);
        }
        for (const taxonomy of taxonomies) {
            const adapter: EBilanzTaxonomyAdapterInterface | undefined = adapters.find(a => a.name === taxonomy.adapter);
            if (adapter == undefined) {
                throw new InternalError(`The taxonomy ${taxonomy.version} of the E-Bilanz needs the adapter "${taxonomy.adapter}" in ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMY_ADAPTERS.`);
            }
            const positions: Map<string, EBilanzTaxonomyPosition> = this.resolvePositions(taxonomy);
            const rows: number = STATEMENT_NAMES.reduce((sum, name) => sum + taxonomy.statements[name].length, 0);
            if (rows !== positions.size) {
                throw new InternalError(`The taxonomy ${taxonomy.version} of the E-Bilanz names a position twice.`);
            }
            for (const position of positions.values()) {
                const unknown: string | undefined = [...position.parent == undefined ? [] : [position.parent], ...position.sums.map(s => s.name)]
                    .find(name => !positions.has(name));
                if (unknown != undefined) {
                    throw new InternalError(`The position ${position.name} of the taxonomy ${taxonomy.version} of the E-Bilanz names ${unknown}, which the taxonomy does not have.`);
                }
            }
            const columns: Set<string> = new Set(taxonomy.fixedAssetColumns.map(([name]) => name));
            for (const [column, sums] of this.resolveFixedAssetColumnSums(taxonomy)) {
                const unknown: string | undefined = sums.map(s => s.name).find(name => !columns.has(name));
                if (unknown != undefined) {
                    throw new InternalError(`The column ${column} of the taxonomy ${taxonomy.version} of the E-Bilanz sums ${unknown}, which the taxonomy does not have.`);
                }
            }
            adapter.validateTaxonomy(taxonomy);
        }
    }

    /**
     * Gets the statements of a taxonomy in the order they are stated.
     * @returns The names of the statements.
     */
    static getStatementNames(): readonly (keyof EBilanzTaxonomyStatements)[] {
        return STATEMENT_NAMES;
    }

    /**
     * Resolves the parts of a sum from their names as the data states them.
     * @param parts - The names, a name with a `-` before it subtracted.
     * @returns Each part with `1` or `-1`.
     */
    private static resolveSums(parts: readonly string[]): EBilanzTaxonomyPosition['sums'] {
        return parts.map(part => part.startsWith('-') ? { name: part.slice(1), weight: -1 } : { name: part, weight: 1 });
    }
}
