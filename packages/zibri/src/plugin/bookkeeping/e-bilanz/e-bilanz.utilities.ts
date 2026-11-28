import { createHash } from 'node:crypto';

import { $f } from '../../../localization/format.function';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { $ts } from '../../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { type BookkeepingCompany } from '../models/bookkeeping-company.model';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';
import { type BookkeepingStatementPosition } from '../models/bookkeeping-statement-position.model';
import { EBilanzTaxonomyUtilities } from './e-bilanz-taxonomy.utilities';
import { type EBilanzAccountMapping } from './models/e-bilanz-account-mapping.model';
import { type EBilanzAccount } from './models/e-bilanz-account.model';
import { type EBilanzAccountBalance } from './models/e-bilanz-account-balance.model';
import { type EBilanzBooks } from './models/e-bilanz-books.model';
import { type EBilanzBusinessAssetComparisonPositions } from './models/e-bilanz-business-asset-comparison-positions.model';
import { type EBilanzContent } from './models/e-bilanz-content.model';
import { type EBilanzField } from './models/e-bilanz-field.model';
import { type EBilanzFinding } from './models/e-bilanz-finding.model';
import { type EBilanzFixedAssetValue } from './models/e-bilanz-fixed-asset-value.model';
import { type EBilanzFixedAsset } from './models/e-bilanz-fixed-asset.model';
import { EBilanzIncomeStatementForm } from './models/e-bilanz-income-statement-form.enum';
import { type EBilanzPosition } from './models/e-bilanz-position.model';
import { type EBilanzPreparation } from './models/e-bilanz-preparation.model';
import { type EBilanzTaxonomyColumnRow } from './models/e-bilanz-taxonomy-column-row.type';
import { type EBilanzTaxonomyPosition } from './models/e-bilanz-taxonomy-position.model';
import { type EBilanzStatementName } from './models/e-bilanz-taxonomy-statements.model';
import { type GermanBookkeepingCompany } from './models/german-bookkeeping-company.model';

/**
 * The currency of every amount of an E-Bilanz, which the findings state the amounts in.
 */
const E_BILANZ_CURRENCY: CurrencyCode = 'EUR';

/**
 * What a `GermanBookkeepingCompany` holds beside a `BookkeepingCompany`, and requires.
 */
const GERMAN_COMPANY_REQUIRED_KEYS: readonly Exclude<keyof GermanBookkeepingCompany, keyof BookkeepingCompany | 'economicId' | 'sender' | 'shareholders'>[] = [
    'legalStatus',
    'taxNumber',
    'taxOfficeNumber',
    'address',
    'business',
    'taxAdvisor'
];

/**
 * The E-Bilanz of a fiscal year as data: resolves its content from the books, the findings that keep it from being
 * filed, and the hash its records name it by.
 */
export abstract class EBilanzUtilities {
    /**
     * Resolves the E-Bilanz of a fiscal year from its books, and what it needs before it can be prepared: each account
     * with a balance on the position of the taxonomy it is mapped to, by itself or by its statement position, the sums
     * of the taxonomy, NIL for each position the tax administration asks for below a position stated, the statement of
     * changes in fixed assets, the steuerlicher Betriebsvermögensvergleich (BVV) and the GCD module. Checked: every
     * account with a balance has a position, the balance sheet balances, each sum equals its parts, the result of the
     * balance sheet and that of the BVV equal that of the income statement, the totals equal those of the statements of
     * the books, and the company is complete.
     * @param books - The books.
     * @returns The content and the findings, none when it can be prepared.
     */
    static resolvePreparation(books: EBilanzBooks): EBilanzPreparation {
        const findings: EBilanzFinding[] = [];
        const positions: Map<string, EBilanzTaxonomyPosition> = EBilanzTaxonomyUtilities.resolvePositions(books.taxonomy);
        const appropriating: boolean = this.isAppropriating(books);
        // the result of the year is part of the balance sheet whether or not it is posted, as in the statements of the
        // books: the balances are those before the closing entry
        const result: BigNumber = BookkeepingStatementUtilities.resolveResult(books.balances.map(b => ({ account: b.account, debit: b.debit, credit: b.credit })));
        const accounts: Map<string, EBilanzAccount[]> = this.resolveAccounts(books, positions, findings, appropriating);
        const amounts: Map<string, BigNumber | null> = this.resolveAmounts(books, positions, accounts, appropriating, result);
        this.resolveBusinessAssetComparison(books, positions, amounts);
        const stated: EBilanzStatementName[] = [
            'balanceSheet',
            books.incomeStatementForm === EBilanzIncomeStatementForm.MICRO ? 'microIncomeStatement' : 'incomeStatement',
            // with every income statement, B.14.3.1.10 of the technical guide
            'businessAssetComparison'
        ];
        const included: EBilanzPosition[] = this.resolveIncluded(positions, amounts, accounts, stated);
        const fixedAssets: EBilanzFixedAsset[] = this.resolveFixedAssets(books, positions, amounts, accounts, findings);
        const statements: Set<EBilanzStatementName> = new Set(included.map(p => p.statement));
        const company: GermanBookkeepingCompany | undefined = this.findGermanCompany(books.company);
        const fields: EBilanzField[] = this.resolveFields(books, company, statements, fixedAssets.length > 0, appropriating);
        if (company == undefined) {
            findings.push({ position: 'genInfo.company', message: $ts`The E-Bilanz needs the company it states: its legal form, tax number, tax office, address and business.` });
        }
        this.validateAmounts(books, positions, amounts, findings, appropriating);
        const content: EBilanzContent = {
            fiscalYearId: books.fiscalYear.id,
            start: books.fiscalYear.start,
            end: books.fiscalYear.end,
            taxonomyVersion: books.taxonomy.version,
            accountingStandard: books.accountingStandard,
            incomeStatementForm: books.incomeStatementForm,
            // the company of the settings, or an empty one the findings name, so the content can be shown either way
            company: company ?? this.resolveMissingCompany(books),
            positions: included,
            fixedAssets,
            fields
        };
        return { content, findings: [...findings, ...this.validateSums(content, positions)] };
    }

    /**
     * Validates that each position of an E-Bilanz that sums others equals the sum of those stated.
     * @param content - The E-Bilanz.
     * @param positions - The positions of its taxonomy.
     * @returns A finding for each position that does not.
     */
    static validateSums(content: EBilanzContent, positions: Map<string, EBilanzTaxonomyPosition>): EBilanzFinding[] {
        const amounts: Map<string, BigNumber | null> = new Map(content.positions.map(p => [p.name, p.amount]));
        return content.positions.flatMap(position => {
            const parts: { name: string, weight: 1 | -1 }[] = [...positions.get(position.name)?.sums ?? []]
                .filter(s => amounts.get(s.name) != undefined);
            if (!parts.length || position.amount == undefined) {
                return [];
            }
            const sum: BigNumber = parts.reduce(
                (total, part) => NumberUtilities.add(total, NumberUtilities.multiply(amounts.get(part.name) ?? 0, part.weight)),
                new BigNumber(0)
            );
            if (sum.isEqualTo(position.amount)) {
                return [];
            }
            const amount: string = $f.price(position.amount, E_BILANZ_CURRENCY);
            const total: string = $f.price(sum, E_BILANZ_CURRENCY);
            return [{ position: position.name, message: $ts`The position "${position.label}" states ${amount} and needs to equal the sum of the positions below it, ${total}.` }];
        });
    }

    /**
     * Resolves the SHA-256 of the content of an E-Bilanz, the same for the same content.
     * @param content - The content.
     * @returns The hash, hex encoded.
     */
    static resolveContentHash(content: EBilanzContent): string {
        return createHash('sha256').update(JSON.stringify(content)).digest('hex');
    }

    /**
     * Finds the company of the bookkeeping settings as the E-Bilanz states it, with what the GCD module asks of it.
     * @param company - The company of the bookkeeping settings, or null or undefined for none.
     * @returns The company, or undefined for none, and for one that does not hold what the GCD module asks.
     */
    static findGermanCompany(company: BookkeepingCompany | null | undefined): GermanBookkeepingCompany | undefined {
        return company != undefined && this.isGermanCompany(company) ? company : undefined;
    }

    /**
     * Resolves the accounts of the equity the steuerlicher Betriebsvermögensvergleich (BVV) compares: each account of
     * the year whose position, by its mapping or its statement position, is one of the equity of the balance sheet or
     * of the deficit not covered by it, those without a balance at the end included. The books need no `equityLines`
     * for it, which are read for these accounts.
     * @param books - The books.
     * @returns The ids of the accounts.
     */
    static resolveEquityAccountIds(books: EBilanzBooks): Set<string> {
        const { equity, deficitNotCoveredByCapital } = books.adapter.businessAssetComparison;
        const isEquity: (name: string) => boolean = name => [equity, deficitNotCoveredByCapital].some(e => name === e || name.startsWith(`${e}.`));
        const mapped: Readonly<Record<string, string>> = books.adapter.resolveStatementPositionMapping(books.taxonomy);
        // an account distributed in full has no balance at the end and is listed under no position, and its opening
        // balance and its distribution are still those of the equity. The appropriation of the result moves accounts
        // within the equity only
        return new Set(books.balances.filter(({ account, debit, credit }) => {
            const net: BigNumber = NumberUtilities.subtract(debit, credit);
            const mapping: EBilanzAccountMapping | undefined = books.accountMappings.find(m => m.accountId === account.id);
            const name: string | undefined = this.findPositionName(mapping, BookkeepingStatementUtilities.findPositionId(account, net), mapped, net);
            return name != undefined && isEquity(name);
        }).map(b => b.account.id));
    }

    /**
     * Finds the position of the taxonomy an account is stated on, outside the appropriation of the result: that of its
     * mapping, its credit position while its balance is a credit, or that its statement position maps to.
     * @param mapping - The mapping of its own, or undefined for none.
     * @param statementPosition - Its statement position by its balance, or undefined for none.
     * @param mapped - The position of the taxonomy of each statement position.
     * @param net - Its debits less its credits.
     * @returns The name of the position, or undefined for none.
     */
    private static findPositionName(
        mapping: EBilanzAccountMapping | undefined,
        statementPosition: string | undefined,
        mapped: Readonly<Record<string, string>>,
        net: BigNumber
    ): string | undefined {
        return mapping == undefined
            ? statementPosition == undefined ? undefined : mapped[statementPosition]
            : net.isLessThan(0) && mapping.creditPosition != undefined ? mapping.creditPosition : mapping.position;
    }

    /**
     * Resolves the amounts of the steuerlicher Betriebsvermögensvergleich (BVV) into those of the positions: the equity
     * at the end of the year, as the balance sheet states it less the deficit not covered by it, that at the end of the
     * year before, as the balances the year starts with state it, no adjustment of it, and the contributions and
     * distributions of the year, each entry of `equityLines` by what its lines on the equity add up to: a contribution
     * where they add up to a credit, a distribution where they add up to a debit. Each sum, such as the result, is that
     * of its parts.
     * @param books - The books.
     * @param positions - The positions of the taxonomy.
     * @param amounts - The amount of each position, which those of the BVV are set in.
     */
    private static resolveBusinessAssetComparison(
        books: EBilanzBooks,
        positions: Map<string, EBilanzTaxonomyPosition>,
        amounts: Map<string, BigNumber | null>
    ): void {
        const comparison: EBilanzBusinessAssetComparisonPositions = books.adapter.businessAssetComparison;
        const equityAccounts: Set<string> = this.resolveEquityAccountIds(books);
        const zero: BigNumber = new BigNumber(0);
        const opening: BigNumber = books.balances
            .filter(b => equityAccounts.has(b.account.id))
            .reduce((sum, b) => NumberUtilities.add(sum, NumberUtilities.subtract(b.openingCredit, b.openingDebit)), zero);
        // an entry moving value between accounts of the equity alone, such as the allocation to the legal reserve, adds
        // up to 0: only what comes into the equity from outside it, or leaves it, is a contribution or a distribution
        const entries: Map<string, BigNumber> = new Map();
        for (const line of books.equityLines.filter(l => equityAccounts.has(l.accountId))) {
            entries.set(line.entryId, NumberUtilities.add(entries.get(line.entryId) ?? zero, line.amount));
        }
        const sumOf: (nets: BigNumber[]) => BigNumber = nets => nets.reduce((sum, n) => NumberUtilities.add(sum, n), zero);
        const nets: BigNumber[] = [...entries.values()];
        const contributions: BigNumber = sumOf(nets.filter(n => n.isGreaterThan(0)));
        const distributions: BigNumber = NumberUtilities.subtract(zero, sumOf(nets.filter(n => n.isLessThan(0))));
        amounts.set(comparison.equityAtEnd, NumberUtilities.subtract(amounts.get(comparison.equity) ?? zero, amounts.get(comparison.deficitNotCoveredByCapital) ?? zero));
        amounts.set(comparison.equityAtPreviousEnd, opening);
        amounts.set(comparison.capitalAdjustments, zero);
        amounts.set(comparison.contributions, contributions);
        amounts.set(comparison.distributions, distributions);
        // the positions below a sum come after it in the taxonomy, so each is resolved before the sum of it
        const sums: EBilanzTaxonomyPosition[] = [...positions.values()].filter(p => p.statement === 'businessAssetComparison' && p.sums.length).reverse();
        for (const sum of sums) {
            amounts.set(sum.name, sum.sums.reduce((total, part) => NumberUtilities.add(total, NumberUtilities.multiply(amounts.get(part.name) ?? zero, part.weight)), zero));
        }
    }

    /**
     * Whether a company of the bookkeeping settings holds what a `GermanBookkeepingCompany` requires.
     * @param company - The company.
     * @returns Whether it does.
     */
    private static isGermanCompany(company: BookkeepingCompany): company is GermanBookkeepingCompany {
        // the plugin refuses to start with another company model, so only a company written before the application
        // registered the German one lacks them: validated against that one, it holds nothing else
        return GERMAN_COMPANY_REQUIRED_KEYS.every(key => key in company);
    }

    /**
     * Resolves the accounts with a balance under each position of the taxonomy.
     * @param books - The books.
     * @param positions - The positions of the taxonomy.
     * @param findings - The findings, which an account without a position is added to.
     * @param appropriating - Whether the balance sheet is drawn up after the partial appropriation of the result.
     * @returns The accounts of each position, by its name, the accounts the closing books the result to under the result
     * position of the balance sheet.
     */
    private static resolveAccounts(
        books: EBilanzBooks,
        positions: Map<string, EBilanzTaxonomyPosition>,
        findings: EBilanzFinding[],
        appropriating: boolean
    ): Map<string, EBilanzAccount[]> {
        const res: Map<string, EBilanzAccount[]> = new Map();
        const add: (name: string, account: EBilanzAccountBalance['account'], net: BigNumber) => void = (name, account, net) => {
            const side: string | undefined = positions.get(name)?.balance;
            res.set(name, [...res.get(name) ?? [], {
                accountId: account.id,
                number: account.number,
                name: account.name,
                balance: side === 'debit' ? net : net.negated()
            }]);
        };
        const mapped: Readonly<Record<string, string>> = books.adapter.resolveStatementPositionMapping(books.taxonomy);
        const { appropriation } = books.adapter;
        for (const balance of books.balances) {
            const net: BigNumber = NumberUtilities.subtract(balance.debit, balance.credit);
            if (net.isZero()) {
                continue;
            }
            const { account } = balance;
            const mapping: EBilanzAccountMapping | undefined = books.accountMappings.find(m => m.accountId === account.id);
            const statementPosition: string | undefined = BookkeepingStatementUtilities.findPositionId(account, net);
            // after a partial appropriation, the result and the profit or loss carried forward are the balance sheet
            // profit, § 268 (1) HGB, and each account of them a line of the appropriation of profits, unless the
            // account is mapped otherwise
            if (appropriating && mapping == undefined
                && (statementPosition === appropriation.statementResultPosition || statementPosition === appropriation.statementCarriedForwardPosition)) {
                const appropriates: boolean = statementPosition === appropriation.statementResultPosition;
                const line: string = appropriates
                    ? account.id === books.legalReserveAllocationAccountId
                        ? appropriation.legalReserve
                        : net.isGreaterThan(0) ? appropriation.otherReserves : appropriation.otherReservesReleased
                    : net.isLessThan(0) ? appropriation.profitCarriedForward : appropriation.lossCarriedForward;
                add(appropriation.balanceSheetProfit, account, net);
                add(line, account, net);
                continue;
            }
            const name: string | undefined = this.findPositionName(mapping, statementPosition, mapped, net);
            const position: EBilanzTaxonomyPosition | undefined = name == undefined ? undefined : positions.get(name);
            const version: string = books.taxonomy.version;
            if (name == undefined) {
                findings.push({
                    position: account.number,
                    message: $ts`The account ${account.number} "${account.name}" has a balance and needs a position in the E-Bilanz: map it to a position of the taxonomy ${version}, or give it a statement position the taxonomy maps.`
                });
                continue;
            }
            if (position == undefined) {
                findings.push({
                    position: account.number,
                    message: $ts`The account ${account.number} "${account.name}" is mapped to ${name}, which the taxonomy ${version} does not have: it needs to be mapped to a position of this taxonomy.`
                });
                continue;
            }
            if ((position.statement === 'balanceSheet') !== this.isBalanceSheetAccount(account.type)) {
                findings.push({
                    position: account.number,
                    message: this.isBalanceSheetAccount(account.type)
                        ? $ts`The account ${account.number} "${account.name}" belongs to the balance sheet and needs to be mapped to a position of the balance sheet, but is mapped to "${position.label}".`
                        : $ts`The account ${account.number} "${account.name}" belongs to the income statement and needs to be mapped to a position of the income statement, but is mapped to "${position.label}".`
                });
                continue;
            }
            if (position.sums.length) {
                findings.push({
                    position: account.number,
                    message: $ts`The account ${account.number} "${account.name}" is mapped to "${position.label}", which only adds up the positions below it: it needs to be mapped to one of those.`
                });
                continue;
            }
            add(position.name, account, net);
        }
        // the account level detail names an account for the result of the year too (B.12.1 of the technical guide):
        // each the closing books part of it to, with that part. Its balances are those before the closing entry, so an
        // account holding a balance of its own is listed with that under its own position, and with the result under
        // this one
        const name: string = appropriating ? appropriation.balanceSheetProfit : books.adapter.balanceSheetResultPosition;
        for (const { account, amount } of books.resultLines.filter(l => !l.amount.isZero())) {
            const balance: BigNumber = positions.get(name)?.balance === 'credit' ? amount : amount.negated();
            const listed: EBilanzAccount[] = res.get(name) ?? [];
            // after a partial appropriation, the account carrying the result forward is part of the balance sheet profit
            // already: one line of it, with both, as is an account two lines carry a part to
            res.set(name, listed.some(a => a.accountId === account.id)
                ? listed.map(a => a.accountId === account.id ? { ...a, balance: NumberUtilities.add(a.balance, balance) } : a)
                : [...listed, { accountId: account.id, number: account.number, name: account.name, balance }]);
        }
        return res;
    }

    /**
     * Whether the balance sheet of the books is drawn up after the partial appropriation of the result: an account
     * without a mapping of its own in the result position of the books, such as the allocation to the legal reserve of
     * a UG, moves part of the result of the year.
     * @param books - The books.
     * @returns Whether it is.
     */
    private static isAppropriating(books: EBilanzBooks): boolean {
        return books.balances.some(b => {
            const net: BigNumber = NumberUtilities.subtract(b.debit, b.credit);
            return !net.isZero()
                && !books.accountMappings.some(m => m.accountId === b.account.id)
                && BookkeepingStatementUtilities.findPositionId(b.account, net) === books.adapter.appropriation.statementResultPosition;
        });
    }

    /**
     * Resolves the amount of each position: what its accounts add up to, the result of the year in the result
     * position of the balance sheet, and the sum of its parts for a position summing others, or null where nothing is
     * stated.
     * @param books - The books.
     * @param positions - The positions of the taxonomy.
     * @param accounts - The accounts of each position.
     * @param appropriating - Whether the balance sheet is drawn up after the partial appropriation of the result.
     * @param result - The result of the year.
     * @returns The amount of each position, by its name.
     */
    private static resolveAmounts(
        books: EBilanzBooks,
        positions: Map<string, EBilanzTaxonomyPosition>,
        accounts: Map<string, EBilanzAccount[]>,
        appropriating: boolean,
        result: BigNumber
    ): Map<string, BigNumber | null> {
        const { appropriation } = books.adapter;
        // the result position of the balance sheet holds the result as the balances of the accounts the closing books it
        // to, where there are any
        const resultPositions: string[] = [
            ...books.resultLines.length ? [] : [appropriating ? appropriation.balanceSheetProfit : books.adapter.balanceSheetResultPosition],
            ...appropriating ? [appropriation.netIncome] : []
        ];
        const res: Map<string, BigNumber | null> = new Map();
        const resolve: (name: string, path: string[]) => BigNumber | null = (name, path) => {
            if (res.has(name)) {
                return res.get(name) ?? null;
            }
            const position: EBilanzTaxonomyPosition | undefined = positions.get(name);
            if (position == undefined || path.includes(name)) {
                return null;
            }
            const parts: BigNumber[] = (accounts.get(name) ?? []).map(a => a.balance);
            if (resultPositions.includes(name) && !result.isZero()) {
                parts.push(position.balance === 'credit' ? result : result.negated());
            }
            for (const sum of position.sums) {
                const amount: BigNumber | null = resolve(sum.name, [...path, name]);
                if (amount != undefined) {
                    parts.push(NumberUtilities.multiply(amount, sum.weight));
                }
            }
            const amount: BigNumber | null = parts.length
                ? parts.reduce((total, part) => NumberUtilities.add(total, part), new BigNumber(0))
                : null;
            res.set(name, amount);
            return amount;
        };
        for (const name of positions.keys()) {
            resolve(name, []);
        }
        return res;
    }

    /**
     * Resolves the positions an E-Bilanz states: each with an amount, and NIL for each the tax administration asks for
     * at the top of a statement stated or below a position stated.
     * @param positions - The positions of the taxonomy.
     * @param amounts - The amount of each.
     * @param accounts - The accounts of each.
     * @param stated - The statements stated from their top.
     * @returns The positions, in the order of the taxonomy.
     */
    private static resolveIncluded(
        positions: Map<string, EBilanzTaxonomyPosition>,
        amounts: Map<string, BigNumber | null>,
        accounts: Map<string, EBilanzAccount[]>,
        stated: EBilanzStatementName[]
    ): EBilanzPosition[] {
        const included: Map<string, boolean> = new Map();
        const isIncluded: (position: EBilanzTaxonomyPosition) => boolean = position => {
            const known: boolean | undefined = included.get(position.name);
            if (known != undefined) {
                return known;
            }
            const parent: EBilanzTaxonomyPosition | undefined = position.parent == undefined ? undefined : positions.get(position.parent);
            const asked: boolean = position.requirement !== 'R'
                && (parent == undefined ? stated.includes(position.statement) : isIncluded(parent));
            // the income statement of a micro corporation sums the positions of the full one, so it has amounts in every
            // E-Bilanz, and is stated only in its own form: a filing of the full form naming its positions is refused
            const other: boolean = position.statement === 'microIncomeStatement' && !stated.includes(position.statement);
            const res: boolean = (amounts.get(position.name) != undefined && !other) || asked;
            included.set(position.name, res);
            return res;
        };
        return [...positions.values()].filter(isIncluded).map(position => ({
            name: position.name,
            statement: position.statement,
            parent: position.parent,
            label: position.label,
            requirement: position.requirement,
            amount: amounts.get(position.name) ?? null,
            accounts: accounts.get(position.name) ?? []
        }));
    }

    /**
     * Resolves the statement of changes in fixed assets: a row of each position of the fixed assets that has accounts,
     * with the figures the preparation names, the additions of the year from the books, and the acquisition costs and
     * the depreciation at the start as 0 for accounts without an opening balance, and each column summing others, such
     * as the book value at the end, as the sum of its parts. Each position above such a row, up to the fixed assets,
     * gets a row too, each column the sum of that of the rows it sums.
     * @param books - The books.
     * @param positions - The positions of the taxonomy.
     * @param amounts - The amount of each position.
     * @param accounts - The accounts of each position.
     * @param findings - The findings, which a row without its acquisition costs at the start, with a sum that is not
     * that of its parts, or with a book value the balance sheet does not state is added to.
     * @returns The rows, in the order of the taxonomy.
     */
    private static resolveFixedAssets(
        books: EBilanzBooks,
        positions: Map<string, EBilanzTaxonomyPosition>,
        amounts: Map<string, BigNumber | null>,
        accounts: Map<string, EBilanzAccount[]>,
        findings: EBilanzFinding[]
    ): EBilanzFixedAsset[] {
        const { fixedAssetsPosition, fixedAssetColumns } = books.adapter;
        const sums: Map<string, EBilanzTaxonomyPosition['sums']> = EBilanzTaxonomyUtilities.resolveFixedAssetColumnSums(books.taxonomy);
        const isFixedAsset: (name: string) => boolean = name => name.startsWith(`${fixedAssetsPosition}.`);
        const labelOf: (name: string) => string = name => positions.get(name)?.label ?? name;
        for (const input of books.fixedAssets) {
            const unknown: string | undefined = input.values.map(v => v.column).find(column => !books.taxonomy.fixedAssetColumns.some(c => c[0] === column));
            const label: string = labelOf(input.position);
            if (!isFixedAsset(input.position) || !positions.has(input.position) || !accounts.has(input.position)) {
                findings.push({
                    position: input.position,
                    message: $ts`The statement of changes in fixed assets names "${label}", which needs to be a position of the fixed assets that accounts are mapped to.`
                });
            }
            else if (unknown != undefined) {
                findings.push({ position: input.position, message: $ts`The statement of changes in fixed assets of "${label}" names the column ${unknown}, which the taxonomy does not have.` });
            }
        }
        // ERiC checks each row against the positions above it, which need rows too, and their sums (B.14.12.1 b of the
        // technical guide). The positions of the dimension are those of the balance sheet, in the same hierarchy, and
        // the build script refuses a version where they are not
        const leaves: string[] = [...accounts.keys()].filter(isFixedAsset);
        const rows: Set<string> = new Set();
        for (const leaf of leaves) {
            let name: string | null = leaf;
            while (name != undefined && !rows.has(name)) {
                rows.add(name);
                name = name === fixedAssetsPosition ? null : positions.get(name)?.parent ?? null;
            }
        }
        const ordered: string[] = [...positions.keys()].filter(name => rows.has(name));
        const columnAmounts: Map<string, Map<string, BigNumber | null>> = new Map();
        // the rows below a position come after it in the taxonomy, so each is resolved before the row summing it
        for (const name of [...ordered].reverse()) {
            columnAmounts.set(name, leaves.includes(name)
                ? this.resolveFixedAssetAmounts(name, labelOf(name), books.taxonomy.fixedAssetColumns, sums, this.resolveFixedAssetFigures(books, name, accounts), findings)
                : this.resolveFixedAssetRowSums(books, positions.get(name)?.sums ?? [], columnAmounts));
        }
        return ordered.map(name => {
            const of: Map<string, BigNumber | null> = columnAmounts.get(name) ?? new Map();
            const values: EBilanzFixedAssetValue[] = books.taxonomy.fixedAssetColumns.map(([column, , , label]) => ({
                column,
                label,
                amount: of.get(column) ?? null
            }));
            const balance: BigNumber | null = amounts.get(name) ?? null;
            const bookValue: BigNumber | null = of.get(fixedAssetColumns.bookValue) ?? null;
            const label: string = labelOf(name);
            if (of.get(fixedAssetColumns.grossBeginning) == undefined) {
                // a position above names no figures of its own: the rows below it say what they need
                if (balance != undefined && leaves.includes(name)) {
                    findings.push({
                        position: name,
                        message: $ts`The statement of changes in fixed assets of "${label}" needs its acquisition costs at the start of the year and the other figures the books do not hold.`
                    });
                }
            }
            // the book value needs to be that of the balance sheet (B.14.12.1 e to g of the technical guide), which it
            // is not while the books credit the account with a depreciation or a disposal the figures do not name
            else if (bookValue != undefined && balance != undefined && !bookValue.isEqualTo(balance)) {
                const [a, b] = [$f.price(bookValue, E_BILANZ_CURRENCY), $f.price(balance, E_BILANZ_CURRENCY)];
                findings.push({
                    position: name,
                    message: leaves.includes(name)
                        ? $ts`The statement of changes in fixed assets of "${label}" ends with a book value of ${a}, which needs to equal the ${b} of the balance sheet: enter the figures the books do not hold, such as the depreciation of the year.`
                        : $ts`The statement of changes in fixed assets of "${label}" ends with a book value of ${a}, which needs to equal the ${b} of the balance sheet: enter the figures the books do not hold for the positions below it.`
                });
            }
            return {
                position: name,
                label,
                parent: name === fixedAssetsPosition ? null : positions.get(name)?.parent ?? null,
                values
            };
        });
    }

    /**
     * Resolves the figures of a row of the statement of changes in fixed assets of a position with accounts: those the
     * preparation names, the additions of the year from the books, and the acquisition costs and the depreciation at
     * the start as 0 for accounts without an opening balance.
     * @param books - The books.
     * @param position - The position of the row.
     * @param accounts - The accounts of each position.
     * @returns The figures, by the name of the column.
     */
    private static resolveFixedAssetFigures(books: EBilanzBooks, position: string, accounts: Map<string, EBilanzAccount[]>): Map<string, BigNumber> {
        const { fixedAssetColumns } = books.adapter;
        const of: EBilanzAccountBalance[] = books.balances.filter(b => accounts.get(position)?.some(a => a.accountId === b.account.id));
        const opened: boolean = of.some(b => !NumberUtilities.subtract(b.openingDebit, b.openingCredit).isZero());
        const derived: Map<string, BigNumber> = new Map();
        derived.set(fixedAssetColumns.additions, of.reduce((sum, b) => NumberUtilities.add(sum, NumberUtilities.subtract(b.debit, b.openingDebit)), new BigNumber(0)));
        // an asset that was not there at the start of the year cost nothing yet and was not depreciated
        if (!opened) {
            derived.set(fixedAssetColumns.grossBeginning, new BigNumber(0));
            derived.set(fixedAssetColumns.depreciationBeginning, new BigNumber(0));
        }
        const given: [string, BigNumber][] = books.fixedAssets.find(f => f.position === position)?.values.map(v => [v.column, v.amount]) ?? [];
        return new Map([...derived, ...given]);
    }

    /**
     * Resolves the amount of each column of a row of the statement of changes in fixed assets of a position summing
     * others: the sum of that column of the rows of the positions it sums, or null where none of them states one.
     * @param books - The books.
     * @param parts - The positions the position sums.
     * @param rows - The amount of each column of each row resolved, by the position of the row.
     * @returns The amount of each column, by its name.
     */
    private static resolveFixedAssetRowSums(
        books: EBilanzBooks,
        parts: EBilanzTaxonomyPosition['sums'],
        rows: Map<string, Map<string, BigNumber | null>>
    ): Map<string, BigNumber | null> {
        return new Map(books.taxonomy.fixedAssetColumns.map(([column]) => {
            const stated: BigNumber[] = parts.flatMap(part => {
                const amount: BigNumber | null | undefined = rows.get(part.name)?.get(column);
                return amount == undefined ? [] : [NumberUtilities.multiply(amount, part.weight)];
            });
            return [column, stated.length ? stated.reduce((sum, amount) => NumberUtilities.add(sum, amount), new BigNumber(0)) : null];
        }));
    }

    /**
     * Resolves the amount of each column of a row of the statement of changes in fixed assets: its figure, and the sum
     * of its parts for a column summing others without one, or null where nothing is stated.
     * @param position - The position of the row.
     * @param label - The label of the position, which a finding names it by.
     * @param columns - The columns of the statement of changes in fixed assets, which a finding names by their label.
     * @param sums - The columns each column sums.
     * @param figures - The figures of the row, given or resolved from the books.
     * @param findings - The findings, which a figure of a column summing others that is not the sum of its parts is
     * added to.
     * @returns The amount of each column, by its name.
     */
    private static resolveFixedAssetAmounts(
        position: string,
        label: string,
        columns: readonly EBilanzTaxonomyColumnRow[],
        sums: Map<string, EBilanzTaxonomyPosition['sums']>,
        figures: Map<string, BigNumber>,
        findings: EBilanzFinding[]
    ): Map<string, BigNumber | null> {
        const res: Map<string, BigNumber | null> = new Map();
        const resolve: (column: string) => BigNumber | null = column => {
            if (res.has(column)) {
                return res.get(column) ?? null;
            }
            const parts: BigNumber[] = (sums.get(column) ?? []).flatMap(part => {
                const amount: BigNumber | null = resolve(part.name);
                return amount == undefined ? [] : [NumberUtilities.multiply(amount, part.weight)];
            });
            const total: BigNumber | null = parts.length ? parts.reduce((sum, part) => NumberUtilities.add(sum, part), new BigNumber(0)) : null;
            const figure: BigNumber | undefined = figures.get(column);
            if (figure != undefined && total != undefined && !figure.isEqualTo(total)) {
                const [a, b] = [$f.price(figure, E_BILANZ_CURRENCY), $f.price(total, E_BILANZ_CURRENCY)];
                const columnLabel: string = columns.find(c => c[0] === column)?.[3] ?? column;
                findings.push({
                    position,
                    message: $ts`The statement of changes in fixed assets of "${label}" states ${a} as "${columnLabel}", which needs to equal the sum of the columns it adds up, ${b}.`
                });
            }
            const amount: BigNumber | null = figure ?? total;
            res.set(column, amount);
            return amount;
        };
        for (const column of sums.keys()) {
            resolve(column);
        }
        return res;
    }

    /**
     * Resolves the fields of the GCD module, NIL for each the adapter has no value of.
     * @param books - The books.
     * @param company - The company it states, or undefined while it is not known.
     * @param statements - The statements the E-Bilanz states a position of.
     * @param fixedAssets - Whether it states a statement of changes in fixed assets.
     * @returns The fields, in the order of the taxonomy.
     */
    private static resolveFields(
        books: EBilanzBooks,
        company: GermanBookkeepingCompany | undefined,
        statements: Set<EBilanzStatementName>,
        fixedAssets: boolean,
        balanceSheetProfit: boolean
    ): EBilanzField[] {
        const values: ReadonlyMap<string, readonly string[]> = books.adapter.resolveFieldValues({
            fiscalYear: books.fiscalYear,
            previousFiscalYear: books.previousFiscalYear,
            company,
            accountingStandard: books.accountingStandard,
            incomeStatementForm: books.incomeStatementForm,
            revisionStatus: books.revisionStatus,
            statements,
            fixedAssets,
            balanceSheetProfit
        });
        return books.taxonomy.gcdFields.flatMap(([name, , label]) => {
            const of: readonly string[] = values.get(name) ?? [''];
            return of.map((value, occurrence) => ({ name, label, value: value === '' ? null : value, occurrence }));
        });
    }

    /**
     * Validates that the balance sheet balances, that its result and that of the steuerlicher Betriebsvermögensvergleich
     * equal that of the income statement, and that the totals equal those of the statements of the books.
     * @param books - The books.
     * @param positions - The positions of the taxonomy, which a finding names by their label.
     * @param amounts - The amount of each position.
     * @param findings - The findings, which what does not hold is added to.
     */
    private static validateAmounts(
        books: EBilanzBooks,
        positions: Map<string, EBilanzTaxonomyPosition>,
        amounts: Map<string, BigNumber | null>,
        findings: EBilanzFinding[],
        appropriating: boolean
    ): void {
        const amountOf: (name: string) => BigNumber = name => amounts.get(name) ?? new BigNumber(0);
        const formattedAmountOf: (name: string) => string = name => $f.price(amountOf(name), E_BILANZ_CURRENCY);
        const labelOf: (name: string) => string = name => positions.get(name)?.label ?? name;
        const [assets, equityAndLiabilities] = books.adapter.balanceSheetTotals;
        if (!amountOf(assets).isEqualTo(amountOf(equityAndLiabilities))) {
            const [a, b] = [formattedAmountOf(assets), formattedAmountOf(equityAndLiabilities)];
            findings.push({
                position: assets,
                message: $ts`The balance sheet does not balance: the assets total ${a}, and the equity and liabilities ${b}. Each account with a balance needs a position on its side of the balance sheet.`
            });
        }
        const { appropriation } = books.adapter;
        const resultPosition: string = appropriating ? appropriation.netIncome : books.adapter.balanceSheetResultPosition;
        const incomePosition: string = books.adapter.incomeStatementResultPositions[books.incomeStatementForm];
        if (appropriating && !amountOf(appropriation.balanceSheetProfit).isEqualTo(amountOf(appropriation.total))) {
            const profit: string = appropriation.balanceSheetProfit;
            const [label, a, b] = [labelOf(profit), formattedAmountOf(profit), formattedAmountOf(appropriation.total)];
            findings.push({
                position: profit,
                message: $ts`The position "${label}" states ${a} and needs to equal the balance sheet profit the appropriation of profits ends with, ${b}.`
            });
        }
        if (!amountOf(resultPosition).isEqualTo(amountOf(incomePosition))) {
            const [label, a, b] = [labelOf(resultPosition), formattedAmountOf(resultPosition), formattedAmountOf(incomePosition)];
            findings.push({
                position: resultPosition,
                message: $ts`The position "${label}" states ${a} and needs to equal the result of the income statement, ${b}: map each account that appropriates the result to a position of the appropriation of profits.`
            });
        }
        // B.14.3.2.12 of the technical guide. The equity at the end is stated as the balance sheet states it, and what
        // the guide checks of the equity at the end of the year before and of the contributions and distributions is
        // checked for sole proprietors and partnerships only
        const comparison: EBilanzBusinessAssetComparisonPositions = books.adapter.businessAssetComparison;
        if (!amountOf(comparison.result).isEqualTo(amountOf(incomePosition))) {
            const [label, a, b] = [labelOf(comparison.result), formattedAmountOf(comparison.result), formattedAmountOf(incomePosition)];
            findings.push({
                position: comparison.result,
                message: $ts`The position "${label}" of the comparison of business assets states ${a} and needs to equal the result of the income statement, ${b}: check the positions the accounts of the equity are mapped to.`
            });
        }
        for (const total of books.adapter.totals) {
            const statement: BookkeepingStatement | undefined = books.statements.find(s => s.positions.some(p => p.id === total.statementPosition));
            const expected: BookkeepingStatementPosition | undefined = statement?.positions.find(p => p.id === total.statementPosition);
            if (expected == undefined) {
                continue;
            }
            // the income statement of the books counts its expenses negative, and so does the taxonomy its result
            if (!expected.amount.isEqualTo(amountOf(total.position))) {
                const [label, a, b] = [labelOf(total.position), formattedAmountOf(total.position), $f.price(expected.amount, E_BILANZ_CURRENCY)];
                findings.push({
                    position: total.position,
                    message: $ts`The position "${label}" states ${a} and needs to equal "${expected.label}" of the statements archived when the fiscal year was closed, ${b}: check the positions its accounts are mapped to.`
                });
            }
        }
    }

    /**
     * Whether an account of a type is on the balance sheet.
     * @param type - The type.
     * @returns Whether it is.
     */
    private static isBalanceSheetAccount(type: BookkeepingAccountType): boolean {
        return type !== BookkeepingAccountType.REVENUE && type !== BookkeepingAccountType.EXPENSE;
    }

    /**
     * Resolves the company of an E-Bilanz whose company is not entered: the name of the bookkeeping settings and
     * nothing else.
     * @param books - The books.
     * @returns The company.
     */
    private static resolveMissingCompany(books: EBilanzBooks): EBilanzContent['company'] {
        return {
            name: books.company?.name ?? '',
            legalStatus: '',
            taxNumber: '',
            taxOfficeNumber: '',
            address: { street: '', houseNumber: '', postalCode: '', city: '', country: '' },
            business: '',
            taxAdvisor: false
        };
    }
}
