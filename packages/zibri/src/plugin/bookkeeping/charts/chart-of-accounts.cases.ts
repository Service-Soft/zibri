import { describe, expect, it } from '@jest/globals';

import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BigNumber } from '../../../utilities/number.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { day, inTenant, journal, testCompany } from '../bookkeeping.cases';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { BookkeepingAccount, type BookkeepingAccountCreateData } from '../models/bookkeeping-account.model';
import { BookkeepingLimits } from '../models/bookkeeping-limits.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';
import { type ChartOfAccounts } from '../models/chart-of-accounts.model';
import { type FiscalYear } from '../models/fiscal-year.model';
import { type NewJournalEntryLine } from '../models/new-journal-entry-line.model';
import { type BookkeepingReportServiceInterface } from '../services/bookkeeping-report-service.interface';
import { HGB_STATEMENT_STRUCTURES } from '../statements/hgb-statement-structures.model';

/**
 * The structure every chart of accounts of the plugin holds to, which a test file per chart runs on a test server with
 * the entities and options of the bookkeeping cases. What each account means is not checked here.
 */

/**
 * Numbers of a chart and the types of the accounts they hold, such as `4000` to `4999` for revenue.
 */
export type AccountNumberRange = {
    /**
     * The first number, such as `4000`.
     */
    from: string,
    /**
     * The last number, such as `4999`.
     */
    until: string,
    /**
     * The types of the accounts numbered in the range.
     */
    types: BookkeepingAccountType[]
};

/**
 * The side of the statements a position is on: the first segment of its id.
 */
type PositionSide = 'assets' | 'equity-and-liabilities' | 'income-statement';

/**
 * The side of the equity and liabilities, the id of its top position.
 */
const EQUITY_AND_LIABILITIES: PositionSide = 'equity-and-liabilities';

/**
 * Where an account is reported, by the side of each of its positions.
 */
type AccountSides = {
    /**
     * The side of the position of the balance its type normally has: a debit for an asset or an expense, a credit for
     * every other.
     */
    normal: string | undefined,
    /**
     * The side of its other position, undefined for an account with one.
     */
    other: string | undefined
};

/**
 * Starts the books of a new GmbH with every account of a chart.
 * @param chart - The chart.
 * @returns The tenant and the accounts, by number.
 */
export async function seedChartOfAccounts(chart: ChartOfAccounts): Promise<[string, Map<string, BookkeepingAccount>]> {
    const tenantId: string = UUIDUtilities.generate();
    const accounts: BookkeepingAccount[] = await inTenant(tenantId, async () => {
        await journal().createSettings({
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
            company: testCompany
        });
        const repository: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
        return await repository.createAll([...chart.accounts]);
    });
    return [tenantId, new Map(accounts.map(a => [a.number, a]))];
}

/**
 * The accounts of a chart a year of typical entries posts on, by their number in the chart.
 */
export type ChartOfAccountsYearAccounts = Record<
    'bank' | 'capital' | 'receivables' | 'revenue19' | 'outputTax19' | 'officeSupplies' | 'inputTax19' | 'payables' | 'rent'
    | 'equipment' | 'vatPrepayment' | 'wages' | 'socialSecurity' | 'payroll' | 'interest' | 'bankFees' | 'depreciation'
    | 'tradeTax' | 'taxProvision',
    string
>;

/**
 * A line of an entry of a year on a chart: the account, the side and the amount.
 */
type ChartLine = [keyof ChartOfAccountsYearAccounts, 'debit' | 'credit', string];

/**
 * The entries of a year of a small GmbH, the same on every chart: capital paid in, an invoice and its payment, an
 * expense and its payment, rent, equipment and its depreciation, the VAT prepayment, wages through the payroll
 * clearing, bank interest and fees, and a provision for trade tax.
 */
const YEAR_ENTRIES: [string, string, ChartLine[]][] = [
    ['2026-01-02', 'Share capital paid in', [['bank', 'debit', '25000.00'], ['capital', 'credit', '25000.00']]],
    [
        '2026-01-15',
        'Invoice 2026-1',
        [['receivables', 'debit', '11900.00'], ['revenue19', 'credit', '10000.00'], ['outputTax19', 'credit', '1900.00']]
    ],
    [
        '2026-02-01',
        'Office supplies',
        [['officeSupplies', 'debit', '200.00'], ['inputTax19', 'debit', '38.00'], ['payables', 'credit', '238.00']]
    ],
    ['2026-02-10', 'Rent February', [['rent', 'debit', '1500.00'], ['bank', 'credit', '1500.00']]],
    ['2026-02-15', 'Invoice 2026-1 paid', [['bank', 'debit', '11900.00'], ['receivables', 'credit', '11900.00']]],
    ['2026-02-20', 'Office supplies paid', [['payables', 'debit', '238.00'], ['bank', 'credit', '238.00']]],
    ['2026-03-01', 'Laptop', [['equipment', 'debit', '1500.00'], ['inputTax19', 'debit', '285.00'], ['bank', 'credit', '1785.00']]],
    ['2026-03-10', 'VAT prepayment', [['vatPrepayment', 'debit', '1577.00'], ['bank', 'credit', '1577.00']]],
    [
        '2026-03-31',
        'Salaries March',
        [['wages', 'debit', '3000.00'], ['socialSecurity', 'debit', '600.00'], ['payroll', 'credit', '3600.00']]
    ],
    ['2026-03-31', 'Salaries March paid', [['payroll', 'debit', '3600.00'], ['bank', 'credit', '3600.00']]],
    ['2026-06-30', 'Bank interest and fees', [['interest', 'debit', '25.00'], ['bankFees', 'debit', '5.00'], ['bank', 'credit', '30.00']]],
    ['2026-12-31', 'Depreciation of the laptop', [['depreciation', 'debit', '500.00'], ['equipment', 'credit', '500.00']]],
    ['2026-12-31', 'Trade tax provision', [['tradeTax', 'debit', '400.00'], ['taxProvision', 'credit', '400.00']]]
];

/**
 * Describes a year of typical entries kept on a chart of accounts: its balance sheet balances, with every balance in a
 * position.
 * @param chart - The chart.
 * @param numbers - The accounts the entries post on, by their number in the chart.
 */
export function describeChartOfAccountsYear(chart: ChartOfAccounts, numbers: ChartOfAccountsYearAccounts): void {
    describe(`a fiscal year kept on the ${chart.name}`, () => {
        it('balances its balance sheet, with every balance in a position', async () => {
            const [tenantId, accounts] = await seedChartOfAccounts(chart);
            const reports: BookkeepingReportServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
            const [balanceSheet, incomeStatement] = await inTenant(tenantId, async () => {
                const fiscalYear: FiscalYear = await journal().createFiscalYear({ start: day('2026-01-01') });
                for (const [postingDate, text, lines] of YEAR_ENTRIES) {
                    await journal().post({
                        documentDate: day(postingDate),
                        postingDate: day(postingDate),
                        documentReference: text,
                        text,
                        lines: lines.map(([name, side, amount]): NewJournalEntryLine => {
                            const account: BookkeepingAccount | undefined = accounts.get(numbers[name]);
                            if (account == undefined) {
                                throw new Error(`The ${chart.name} has no account ${numbers[name]}.`);
                            }
                            return {
                                accountId: account.id,
                                debit: side === 'debit' ? new BigNumber(amount) : null,
                                credit: side === 'credit' ? new BigNumber(amount) : null
                            };
                        })
                    });
                }
                return await Promise.all([
                    reports.resolveBalanceSheet(fiscalYear.id, 'hgb.balance-sheet'),
                    reports.resolveIncomeStatement(fiscalYear.id, 'hgb.income-statement')
                ]);
            });

            const amountOf: (statement: BookkeepingStatement, id: string) => string | undefined = (statement, id) => statement.positions
                .find(p => p.id === id)?.amount.toFixed(2);
            expect(balanceSheet.unmapped).toEqual([]);
            expect(incomeStatement.unmapped).toEqual([]);
            expect(amountOf(balanceSheet, 'assets')).toBe('31070.00');
            expect(amountOf(balanceSheet, EQUITY_AND_LIABILITIES)).toBe('31070.00');
            expect(amountOf(balanceSheet, 'assets.A.II.3')).toBe('1000.00');
            // the input tax and the VAT prepayment
            expect(amountOf(balanceSheet, 'assets.B.II.4')).toBe('1900.00');
            expect(amountOf(balanceSheet, 'assets.B.IV')).toBe('28170.00');
            expect(amountOf(balanceSheet, 'equity-and-liabilities.A.I')).toBe('25000.00');
            expect(amountOf(balanceSheet, 'equity-and-liabilities.A.V')).toBe('3770.00');
            expect(amountOf(balanceSheet, 'equity-and-liabilities.B.2')).toBe('400.00');
            expect(amountOf(balanceSheet, 'equity-and-liabilities.C.8')).toBe('1900.00');
            expect(amountOf(incomeStatement, 'income-statement.1')).toBe('10000.00');
            expect(amountOf(incomeStatement, 'income-statement.6')).toBe('-3600.00');
            expect(amountOf(incomeStatement, 'income-statement.17')).toBe('3770.00');
        });
    });
}

/**
 * Describes the structure of a chart of accounts.
 * @param chart - The chart.
 * @param ranges - The numbers of the chart and the types of the accounts they hold.
 */
export function describeChartOfAccounts(chart: ChartOfAccounts, ranges: AccountNumberRange[]): void {
    describe(`the chart of accounts ${chart.name}`, () => {
        it('numbers each account once, with 4 digits, in ascending order', () => {
            const numbers: string[] = chart.accounts.map(a => a.number);
            expect(numbers.filter(n => !/^\d{4}$/u.test(n))).toEqual([]);
            expect(numbers.filter((n, index) => numbers.indexOf(n) !== index)).toEqual([]);
            expect(numbers).toEqual([...numbers].sort());
        });

        it('numbers each account in a class of its type', () => {
            const misplaced: string[] = chart.accounts
                .filter(a => !ranges.some(r => a.number >= r.from && a.number <= r.until && r.types.includes(a.type)))
                .map(a => `${a.number} ${a.type}`);
            expect(misplaced).toEqual([]);
        });

        it('names each account within the length of a name', () => {
            const unnamed: string[] = chart.accounts
                .filter(a => a.name.trim() === '' || a.name.length > BookkeepingLimits.NAME_MAX_LENGTH)
                .map(a => a.number);
            expect(unnamed).toEqual([]);
        });

        it('maps each account to positions the full HGB statements map accounts to', () => {
            const mappable: Map<string, BookkeepingStatementType> = BookkeepingStatementUtilities
                .resolveMappablePositions(HGB_STATEMENT_STRUCTURES);
            const unknown: string[] = chart.accounts.flatMap(a => [a.statementPosition, a.creditStatementPosition]
                .filter(position => position != undefined && !mappable.has(position))
                .map(position => `${a.number} ${position}`));
            expect(unknown).toEqual([]);
        });

        it('maps each account on the side of its type', () => {
            const wrong: string[] = chart.accounts
                .filter(a => a.statementPosition != undefined)
                .filter(a => {
                    const sides: AccountSides = resolveSides(a);
                    const [normal, other] = resolveExpectedSides(a.type);
                    return sides.normal !== normal || (sides.other != undefined && sides.other !== other);
                })
                .map(a => `${a.number} ${a.type} ${a.statementPosition} ${a.creditStatementPosition}`);
            expect(wrong).toEqual([]);
        });

        it('leaves only carry-forward and statistical accounts of class 9 without a position', () => {
            const unmapped: string[] = chart.accounts
                .filter(a => a.statementPosition == undefined)
                .filter(a => !a.number.startsWith('9') || a.creditStatementPosition != undefined)
                .map(a => a.number);
            expect(unmapped).toEqual([]);
        });

        it('seeds every account through the account repository', async () => {
            const [, accounts] = await seedChartOfAccounts(chart);
            expect([...accounts.values()].map(a => ({
                number: a.number,
                name: a.name,
                type: a.type,
                statementPosition: a.statementPosition ?? null,
                creditStatementPosition: a.creditStatementPosition ?? null
            }))).toEqual(chart.accounts.map(a => ({
                number: a.number,
                name: a.name,
                type: a.type,
                statementPosition: a.statementPosition ?? null,
                creditStatementPosition: a.creditStatementPosition ?? null
            })));
        });
    });
}

/**
 * Resolves the sides of the statements an account is reported on.
 * @param account - The account, with a `statementPosition`.
 * @returns The side of the position of its normal balance, and that of its other position.
 */
function resolveSides(account: BookkeepingAccountCreateData): AccountSides {
    const debit: string | undefined = account.statementPosition?.split('.')[0];
    const credit: string | undefined = account.creditStatementPosition?.split('.')[0];
    if (account.type === BookkeepingAccountType.ASSET || account.type === BookkeepingAccountType.EXPENSE) {
        return { normal: debit, other: credit };
    }
    return credit == undefined ? { normal: debit, other: undefined } : { normal: credit, other: debit };
}

/**
 * Resolves the sides an account of a type is reported on.
 * @param type - The type of the account.
 * @returns The side of its normal balance, and the side of a balance on the other side.
 */
function resolveExpectedSides(type: BookkeepingAccountType): [PositionSide, PositionSide] {
    switch (type) {
        case BookkeepingAccountType.ASSET: {
            return ['assets', EQUITY_AND_LIABILITIES];
        }
        case BookkeepingAccountType.LIABILITY:
        case BookkeepingAccountType.EQUITY: {
            return [EQUITY_AND_LIABILITIES, 'assets'];
        }
        case BookkeepingAccountType.REVENUE:
        case BookkeepingAccountType.EXPENSE: {
            return ['income-statement', 'income-statement'];
        }
    }
}
