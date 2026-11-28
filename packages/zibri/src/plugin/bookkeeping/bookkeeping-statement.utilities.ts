import { InternalError } from '../../error-handling/internal-error.model';
import { type TranslationToken } from '../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { type BookkeepingAccountAmount } from './models/bookkeeping-account-amount.model';
import { type BookkeepingAccountBalance } from './models/bookkeeping-account-balance.model';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { type BookkeepingAccount } from './models/bookkeeping-account.model';
import { type BookkeepingBalanceSide } from './models/bookkeeping-balance-side.type';
import { type BookkeepingStatementPositionDefinition } from './models/bookkeeping-statement-position-definition.model';
import { type BookkeepingStatementPosition } from './models/bookkeeping-statement-position.model';
import { type BookkeepingStatementStructure } from './models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from './models/bookkeeping-statement-type.enum';

/**
 * A position of a structure, with where it is in it.
 */
type PositionEntry = {
    /**
     * The position.
     */
    definition: BookkeepingStatementPositionDefinition,
    /**
     * The id of the position it is below, or null for one at the top.
     */
    parentId: string | null,
    /**
     * How deep it is below the top.
     */
    depth: number,
    /**
     * The side whose balance counts positive in it.
     */
    side: BookkeepingBalanceSide
};

/**
 * The positions and the accounts without a position of a statement.
 */
type ResolvedStatement = {
    /**
     * Every position of the structure, in its order.
     */
    positions: BookkeepingStatementPosition[],
    /**
     * The accounts of the statement with a balance and no position.
     */
    unmapped: BookkeepingAccountAmount[]
};

/**
 * The statements of a fiscal year from the balances of its accounts: which position an account is reported in, what
 * the positions of a structure add up to, and whether the structures hold together.
 */
export abstract class BookkeepingStatementUtilities {
    /**
     * Resolves the statement the accounts of a type are reported in.
     * @param type - The type of an account.
     * @returns The income statement for a revenue or expense account, the balance sheet for every other.
     */
    static resolveStatementType(type: BookkeepingAccountType): BookkeepingStatementType {
        return type === BookkeepingAccountType.REVENUE || type === BookkeepingAccountType.EXPENSE
            ? BookkeepingStatementType.INCOME_STATEMENT
            : BookkeepingStatementType.BALANCE_SHEET;
    }

    /**
     * Finds the position an account is reported in by its balance: its `creditStatementPosition` while the balance is
     * a credit and it has one, its `statementPosition` otherwise.
     * @param account - The account.
     * @param balance - Its debits less its credits.
     * @returns The id of the position, or undefined for an account without one.
     */
    static findPositionId(account: Pick<BookkeepingAccount, 'statementPosition' | 'creditStatementPosition'>, balance: BigNumber): string | undefined {
        if (balance.isLessThan(0) && account.creditStatementPosition != undefined) {
            return account.creditStatementPosition;
        }
        return account.statementPosition ?? undefined;
    }

    /**
     * Whether an account is a carry-forward account, which the balances of books kept elsewhere before are carried over
     * against by hand, such as `9000` to `9090` of the SKR 03 and 04: an equity account in no position, its balance 0
     * once every balance is carried over.
     * @param account - The account.
     * @returns Whether it is.
     */
    static isCarryForwardAccount(account: Pick<BookkeepingAccount, 'type' | 'statementPosition' | 'creditStatementPosition'>): boolean {
        return account.type === BookkeepingAccountType.EQUITY && account.statementPosition == undefined && account.creditStatementPosition == undefined;
    }

    /**
     * Resolves the result of a fiscal year: the credits less the debits of its revenue and expense accounts.
     * @param balances - The balances of the fiscal year.
     * @returns The result, positive for a profit.
     */
    static resolveResult(balances: BookkeepingAccountBalance[]): BigNumber {
        return balances
            .filter(b => this.resolveStatementType(b.account.type) === BookkeepingStatementType.INCOME_STATEMENT)
            .reduce((sum, b) => NumberUtilities.add(sum, NumberUtilities.subtract(b.credit, b.debit)), new BigNumber(0));
    }

    /**
     * Resolves the positions accounts are mapped to: those of the full structures without positions below them and
     * without sums.
     * @param structures - The structures.
     * @returns The type of the statement of each position, by its id.
     */
    static resolveMappablePositions(structures: readonly BookkeepingStatementStructure[]): Map<string, BookkeepingStatementType> {
        const res: Map<string, BookkeepingStatementType> = new Map();
        for (const structure of structures.filter(s => s.rollsUpFrom == undefined)) {
            for (const entry of this.resolvePositionEntries(structure).values()) {
                if (this.isMappable(entry.definition)) {
                    res.set(entry.definition.id, structure.type);
                }
            }
        }
        return res;
    }

    /**
     * Resolves a position of a shortened structure with the id and the label of a position of a full one: the sum of
     * that position, or of the positions given below it.
     * @param full - The full structure.
     * @param id - The id of the position of the full structure.
     * @param positions - The positions below it, none for a position adding up the full one.
     * @returns The position.
     * @throws An InternalError when the full structure has no such position.
     */
    static resolveRolledUpPosition(
        full: BookkeepingStatementStructure,
        id: string,
        positions?: BookkeepingStatementPositionDefinition[]
    ): BookkeepingStatementPositionDefinition {
        const entry: PositionEntry | undefined = this.resolvePositionEntries(full).get(id);
        if (entry == undefined) {
            throw new InternalError(`The statement structure "${full.id}" has no position "${id}".`);
        }
        return positions == undefined
            ? { id, label: entry.definition.label, sums: [id] }
            : { id, label: entry.definition.label, positions };
    }

    /**
     * Validates that structures hold together: unique ids, sums of positions that exist without a cycle, a shortened
     * structure rolling up from a full one of its type, a result position that exists, and the positions accounts
     * are mapped to unique among the full structures.
     * @param structures - The structures.
     * @throws An InternalError naming the first that does not.
     */
    static validateStructures(structures: readonly BookkeepingStatementStructure[]): void {
        const ids: Set<string> = new Set();
        const owners: Map<string, string> = new Map();
        for (const structure of structures) {
            if (ids.has(structure.id)) {
                throw new InternalError(`The statement structure "${structure.id}" is registered twice.`);
            }
            ids.add(structure.id);
            const entries: Map<string, PositionEntry> = this.resolvePositionEntries(structure);
            const full: BookkeepingStatementStructure | undefined = structure.rollsUpFrom == undefined
                ? structure
                : structures.find(s => s.id === structure.rollsUpFrom && s.rollsUpFrom == undefined && s.type === structure.type);
            if (full == undefined) {
                throw new InternalError(
                    `The statement structure "${structure.id}" needs to roll up from a full structure of the type ${structure.type}, and "${structure.rollsUpFrom}" is none.`
                );
            }
            const summed: Map<string, PositionEntry> = full === structure ? entries : this.resolvePositionEntries(full);
            for (const entry of entries.values()) {
                const unknown: string | undefined = entry.definition.sums?.find(id => !summed.has(id));
                if (unknown != undefined) {
                    throw new InternalError(`The position "${entry.definition.id}" of "${structure.id}" sums "${unknown}", which "${full.id}" does not have.`);
                }
                if (full === structure && this.isMappable(entry.definition)) {
                    const owner: string | undefined = owners.get(entry.definition.id);
                    if (owner != undefined) {
                        throw new InternalError(`The position "${entry.definition.id}" is a position of "${owner}" and "${structure.id}", which accounts cannot tell apart.`);
                    }
                    owners.set(entry.definition.id, structure.id);
                }
            }
            if (structure.resultPosition != undefined && !entries.has(structure.resultPosition)) {
                throw new InternalError(`The result position "${structure.resultPosition}" of "${structure.id}" needs to be one of its positions.`);
            }
            if (full === structure) {
                for (const id of entries.keys()) {
                    this.validateNoCycle(structure, entries, id, []);
                }
            }
        }
    }

    /**
     * Resolves the positions of a statement from the balances of the fiscal year: each account with a balance in the
     * position its balance names, the amount of each position, and the accounts without a position. A shortened
     * structure adds up the amounts of the full one it rolls up from.
     * @param structure - The structure of the statement.
     * @param structures - Every structure, among them the full one a shortened structure rolls up from.
     * @param balances - The balances of the accounts in the fiscal year.
     * @param result - The result of the fiscal year, part of the result position of a balance sheet.
     * @param translate - Translates a label.
     * @returns The positions, in the order of the structure, and the accounts without a position.
     */
    static resolveStatement(
        structure: BookkeepingStatementStructure,
        structures: readonly BookkeepingStatementStructure[],
        balances: BookkeepingAccountBalance[],
        result: BigNumber,
        translate: (label: TranslationToken) => string
    ): ResolvedStatement {
        const full: BookkeepingStatementStructure | undefined = structure.rollsUpFrom == undefined
            ? structure
            : structures.find(s => s.id === structure.rollsUpFrom);
        if (full == undefined) {
            throw new InternalError(`The statement structure "${structure.id}" rolls up from "${structure.rollsUpFrom}", which is not registered.`);
        }
        const fullEntries: Map<string, PositionEntry> = this.resolvePositionEntries(full);
        const accounts: Map<string, BookkeepingAccountAmount[]> = new Map();
        const unmapped: BookkeepingAccountAmount[] = [];
        for (const balance of balances) {
            if (this.resolveStatementType(balance.account.type) !== full.type) {
                continue;
            }
            const net: BigNumber = NumberUtilities.subtract(balance.debit, balance.credit);
            if (net.isZero()) {
                continue;
            }
            const positionId: string | undefined = this.findPositionId(balance.account, net);
            const entry: PositionEntry | undefined = positionId == undefined ? undefined : fullEntries.get(positionId);
            if (entry == undefined || !this.isMappable(entry.definition)) {
                const byDebit: boolean = balance.account.type === BookkeepingAccountType.ASSET || balance.account.type === BookkeepingAccountType.EXPENSE;
                unmapped.push(this.resolveAccountAmount(balance.account, byDebit ? net : net.negated()));
                continue;
            }
            const amounts: BookkeepingAccountAmount[] = accounts.get(entry.definition.id) ?? [];
            amounts.push(this.resolveAccountAmount(balance.account, entry.side === 'debit' ? net : net.negated()));
            accounts.set(entry.definition.id, amounts);
        }

        const fullAmounts: Map<string, BigNumber> = new Map();
        const resolveFullAmount: (id: string) => BigNumber = id => {
            const known: BigNumber | undefined = fullAmounts.get(id);
            if (known != undefined) {
                return known;
            }
            const entry: PositionEntry | undefined = fullEntries.get(id);
            if (entry == undefined) {
                throw new InternalError(`The statement structure "${full.id}" has no position "${id}".`);
            }
            const parts: BigNumber[] = [
                ...(accounts.get(id) ?? []).map(a => a.amount),
                ...(entry.definition.positions ?? []).map(p => resolveFullAmount(p.id)),
                ...(entry.definition.sums ?? []).map(resolveFullAmount),
                // the result of the year, whether or not it is posted: before the closing it is in the revenue and
                // expense accounts alone, and the closing entry is not read
                ...id === full.resultPosition ? [entry.side === 'credit' ? result : result.negated()] : []
            ];
            const amount: BigNumber = parts.reduce((sum, part) => NumberUtilities.add(sum, part), new BigNumber(0));
            fullAmounts.set(id, amount);
            return amount;
        };

        const fullPositions: BookkeepingStatementPosition[] = [...fullEntries.values()].map(entry => ({
            id: entry.definition.id,
            parentId: entry.parentId,
            depth: entry.depth,
            label: translate(entry.definition.label),
            amount: resolveFullAmount(entry.definition.id),
            previousAmount: null,
            accounts: accounts.get(entry.definition.id) ?? []
        }));
        return { positions: this.resolveFormPositions(structure, fullPositions, translate), unmapped };
    }

    /**
     * Resolves the positions of a form from those of the full statement of the same fiscal year, such as of one
     * archived at its closing: the full positions for the full form, and for a shortened one the sums it names.
     * @param structure - The structure of the form.
     * @param fullPositions - The positions of the full statement.
     * @param translate - Translates a label.
     * @returns The positions, in the order of the structure, without the amounts of the year before.
     */
    static resolveFormPositions(
        structure: BookkeepingStatementStructure,
        fullPositions: BookkeepingStatementPosition[],
        translate: (label: TranslationToken) => string
    ): BookkeepingStatementPosition[] {
        if (structure.rollsUpFrom == undefined) {
            return fullPositions.map(p => ({ ...p, previousAmount: null }));
        }
        const byId: Map<string, BookkeepingStatementPosition> = new Map(fullPositions.map(p => [p.id, p]));
        const children: Map<string, BookkeepingStatementPosition[]> = new Map();
        for (const position of fullPositions) {
            if (position.parentId != undefined) {
                children.set(position.parentId, [...children.get(position.parentId) ?? [], position]);
            }
        }
        const collectAccounts: (id: string) => BookkeepingAccountAmount[] = id => [
            ...byId.get(id)?.accounts ?? [],
            ...(children.get(id) ?? []).flatMap(child => collectAccounts(child.id))
        ];
        const amounts: Map<string, BigNumber> = new Map();
        const resolveAmount: (definition: BookkeepingStatementPositionDefinition) => BigNumber = definition => {
            const amount: BigNumber = [
                ...(definition.positions ?? []).map(resolveAmount),
                // a position the full statement does not have, such as of an archived one of an older structure, adds
                // nothing
                ...(definition.sums ?? []).map(id => byId.get(id)?.amount ?? new BigNumber(0))
            ].reduce((sum, part) => NumberUtilities.add(sum, part), new BigNumber(0));
            amounts.set(definition.id, amount);
            return amount;
        };
        for (const definition of structure.positions) {
            resolveAmount(definition);
        }
        return [...this.resolvePositionEntries(structure).values()].map(entry => ({
            id: entry.definition.id,
            parentId: entry.parentId,
            depth: entry.depth,
            label: translate(entry.definition.label),
            amount: amounts.get(entry.definition.id) ?? new BigNumber(0),
            previousAmount: null,
            accounts: (entry.definition.sums ?? []).flatMap(collectAccounts)
        }));
    }

    /**
     * Resolves the positions of a statement with the amounts of the year before, by the ids of their positions.
     * @param positions - The positions.
     * @param previous - The positions of the same form in the year before, or undefined for a statement without one.
     * @returns The positions, each with its `previousAmount`: 0 for a position the year before does not have, and null
     * every one without a year before.
     */
    static resolvePreviousAmounts(
        positions: BookkeepingStatementPosition[],
        previous: BookkeepingStatementPosition[] | undefined
    ): BookkeepingStatementPosition[] {
        const byId: Map<string, BigNumber> = new Map((previous ?? []).map(p => [p.id, p.amount]));
        return positions.map(p => ({ ...p, previousAmount: previous == undefined ? null : byId.get(p.id) ?? new BigNumber(0) }));
    }

    /**
     * Resolves the positions of a structure, in its order, each after the position it is below.
     * @param structure - The structure.
     * @returns The positions, by id.
     * @throws An InternalError for an id the structure has twice.
     */
    private static resolvePositionEntries(structure: BookkeepingStatementStructure): Map<string, PositionEntry> {
        const res: Map<string, PositionEntry> = new Map();
        const visit: (definition: BookkeepingStatementPositionDefinition, parent: PositionEntry | undefined) => void = (definition, parent) => {
            if (res.has(definition.id)) {
                throw new InternalError(`The statement structure "${structure.id}" has the position "${definition.id}" twice.`);
            }
            const entry: PositionEntry = {
                definition,
                parentId: parent?.definition.id ?? null,
                depth: parent == undefined ? 0 : parent.depth + 1,
                side: definition.positiveBalance ?? parent?.side ?? structure.positiveBalance
            };
            res.set(definition.id, entry);
            for (const child of definition.positions ?? []) {
                visit(child, entry);
            }
        };
        for (const definition of structure.positions) {
            visit(definition, undefined);
        }
        return res;
    }

    /**
     * Validates that the sums of a position of a full structure do not lead back to it.
     * @param structure - The structure.
     * @param entries - Its positions.
     * @param id - The id of the position.
     * @param path - The positions summing it, the first first.
     * @throws An InternalError naming the cycle.
     */
    private static validateNoCycle(structure: BookkeepingStatementStructure, entries: Map<string, PositionEntry>, id: string, path: string[]): void {
        if (path.includes(id)) {
            throw new InternalError(`The positions ${[...path, id].join(' -> ')} of "${structure.id}" sum each other.`);
        }
        const definition: BookkeepingStatementPositionDefinition | undefined = entries.get(id)?.definition;
        for (const next of [...definition?.sums ?? [], ...(definition?.positions ?? []).map(p => p.id)]) {
            this.validateNoCycle(structure, entries, next, [...path, id]);
        }
    }

    /**
     * Whether accounts are mapped to a position: one without positions below it and without sums.
     * @param definition - The position.
     * @returns Whether they are.
     */
    private static isMappable(definition: BookkeepingStatementPositionDefinition): boolean {
        return !(definition.positions?.length ?? 0) && !(definition.sums?.length ?? 0);
    }

    /**
     * Resolves what an account adds to a report.
     * @param account - The account.
     * @param amount - The amount.
     * @returns The amount of the account.
     */
    private static resolveAccountAmount(account: BookkeepingAccount, amount: BigNumber): BookkeepingAccountAmount {
        return { accountId: account.id, number: account.number, name: account.name, amount };
    }
}
