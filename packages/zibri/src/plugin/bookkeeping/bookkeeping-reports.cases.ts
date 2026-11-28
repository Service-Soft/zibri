/* eslint-disable sonar/no-duplicate-string -- the days, amounts and position ids are the figures of the cases */
import { type Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from '@jest/globals';

import { PdfmakeTestUtilities } from '../../__testing__/pdfmake-test.utilities';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { type PdfDocumentDefinition } from '../../document/pdf.utilities';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { type Invoice } from '../invoicing/models/invoice.model';
import { type InvoiceCancellationServiceInterface } from '../invoicing/services/invoice-cancellation-service.interface';
import { createPostingBooks,
    createTransaction,
    issueInvoice,
    itemOf,
    type PostingAccountName,
    type PostingBooks,
    postingTestProviders,
    rentOf,
    suggest } from './bookkeeping-postings.cases';
import { day, inTenant, journal, testCompany } from './bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { BookkeepingAccount, type BookkeepingAccountCreateData } from './models/bookkeeping-account.model';
import { type BookkeepingClosingProposal } from './models/bookkeeping-closing-proposal.model';
import { type BookkeepingJournalReport } from './models/bookkeeping-journal-report.model';
import { type BookkeepingLedgerReport } from './models/bookkeeping-ledger-report.model';
import { type BookkeepingLegalForm } from './models/bookkeeping-legal-form.model';
import { type BookkeepingRevenueReport } from './models/bookkeeping-revenue-report.model';
import { type BookkeepingSettings } from './models/bookkeeping-settings.model';
import { type BookkeepingStatementFormChoices } from './models/bookkeeping-statement-form-choices.model';
import { type BookkeepingStatementForm } from './models/bookkeeping-statement-form.model';
import { type BookkeepingStatementStructure } from './models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from './models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from './models/bookkeeping-statement.model';
import { type BookkeepingTrialBalance } from './models/bookkeeping-trial-balance.model';
import { FiscalYearStatement } from './models/fiscal-year-statement.model';
import { FiscalYear } from './models/fiscal-year.model';
import { type JournalEntryDetails } from './models/journal-entry-details.model';
import { type NewFiscalYear } from './models/new-fiscal-year.model';
import { type PostingRules } from './models/posting-rules.model';
import { type BookkeepingReportPdfServiceInterface } from './services/bookkeeping-report-pdf-service.interface';
import { type BookkeepingReportServiceInterface } from './services/bookkeeping-report-service.interface';
import { HgbCorporationConformanceService } from './services/conformance/hgb/hgb-corporation-conformance.service';
import { HgbSizeClass } from './services/conformance/hgb/hgb-size-class.enum';
import { type ExpenseServiceInterface } from './services/expense-service.interface';
import { HGB_BALANCE_SHEET } from './statements/hgb-balance-sheet.model';
import { HGB_INCOME_STATEMENT } from './statements/hgb-income-statement.model';
import { HGB_MICRO_BALANCE_SHEET } from './statements/hgb-micro-balance-sheet.model';
import { HGB_MICRO_INCOME_STATEMENT } from './statements/hgb-micro-income-statement.model';
import { HGB_SMALL_BALANCE_SHEET } from './statements/hgb-small-balance-sheet.model';

/**
 * The cases every data source answers the same way about the reports of the books: the journal, the ledger, the
 * trial balance, the statements in every form, the revenue, and the conformances of the HGB and of a UG. A file per
 * data source runs them, with the entities, file stores and plugins of the cases of the postings, and the providers of
 * {@link reportTestProviders}.
 */

/**
 * The note below the balance sheet of a micro corporation in the cases.
 */
const MICRO_NOTE: string = 'Haftungsverhältnisse nach § 268 Abs. 7 HGB bestehen nicht.';

/**
 * The providers of the cases: those of the postings.
 */
export const reportTestProviders: DiProvider<unknown>[] = postingTestProviders;

/**
 * The positions of the accounts of the books of the postings, named after the SKR 03.
 */
const POSITIONS: Record<PostingAccountName, Pick<BookkeepingAccount, 'statementPosition' | 'creditStatementPosition'>> = {
    bank: { statementPosition: 'assets.B.IV', creditStatementPosition: 'equity-and-liabilities.C.2' },
    receivables: { statementPosition: 'assets.B.II.1', creditStatementPosition: null },
    inputTax19: { statementPosition: 'assets.B.II.4', creditStatementPosition: 'equity-and-liabilities.C.8' },
    payables: { statementPosition: 'equity-and-liabilities.C.4', creditStatementPosition: null },
    outputTax7: { statementPosition: 'assets.B.II.4', creditStatementPosition: 'equity-and-liabilities.C.8' },
    outputTax19: { statementPosition: 'assets.B.II.4', creditStatementPosition: 'equity-and-liabilities.C.8' },
    vatPrepayment: { statementPosition: 'assets.B.II.4', creditStatementPosition: 'equity-and-liabilities.C.8' },
    capital: { statementPosition: 'equity-and-liabilities.A.I', creditStatementPosition: null },
    result: { statementPosition: 'equity-and-liabilities.A.IV', creditStatementPosition: null },
    rent: { statementPosition: 'income-statement.8', creditStatementPosition: null },
    revenueExempt: { statementPosition: 'income-statement.1', creditStatementPosition: null },
    revenue7: { statementPosition: 'income-statement.1', creditStatementPosition: null },
    revenue19: { statementPosition: 'income-statement.1', creditStatementPosition: null },
    difference7: { statementPosition: 'income-statement.1', creditStatementPosition: null },
    difference19: { statementPosition: 'income-statement.1', creditStatementPosition: null }
};

/**
 * The accounts of the books the cases post by hand, by what they are called in them.
 */
type HandAccountName = 'bank' | 'vat' | 'suspense' | 'reserve' | 'capital' | 'carried' | 'allocation' | 'rent' | 'revenue'
    | 'unmappedRevenue';

const HAND_ACCOUNTS: Record<HandAccountName, BookkeepingAccountCreateData> = {
    bank: {
        number: '1200',
        name: 'Bank',
        type: BookkeepingAccountType.ASSET,
        statementPosition: 'assets.B.IV',
        creditStatementPosition: 'equity-and-liabilities.C.2'
    },
    vat: {
        number: '1776',
        name: 'VAT 19 %',
        type: BookkeepingAccountType.LIABILITY,
        statementPosition: 'assets.B.II.4',
        creditStatementPosition: 'equity-and-liabilities.C.8'
    },
    suspense: {
        number: '1590',
        name: 'Suspense',
        type: BookkeepingAccountType.ASSET,
        statementPosition: null,
        creditStatementPosition: null
    },
    reserve: {
        number: '0846',
        name: 'Legal reserve',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.III.1',
        creditStatementPosition: null
    },
    capital: {
        number: '2900',
        name: 'Share capital',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.I',
        creditStatementPosition: null
    },
    carried: {
        number: '2970',
        name: 'Profit carried forward',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.IV',
        creditStatementPosition: null
    },
    allocation: {
        number: '2496',
        name: 'Allocation to the legal reserve',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.V',
        creditStatementPosition: null
    },
    rent: {
        number: '4210',
        name: 'Rent',
        type: BookkeepingAccountType.EXPENSE,
        statementPosition: 'income-statement.8',
        creditStatementPosition: null
    },
    revenue: {
        number: '8400',
        name: 'Revenue 19 %',
        type: BookkeepingAccountType.REVENUE,
        statementPosition: 'income-statement.1',
        creditStatementPosition: null
    },
    unmappedRevenue: {
        number: '8999',
        name: 'Revenue to map',
        type: BookkeepingAccountType.REVENUE,
        statementPosition: null,
        creditStatementPosition: null
    }
};

/**
 * Books of a tenant of its own, posted by hand.
 */
type HandBooks = {

    tenantId: string,

    settings: BookkeepingSettings,

    accounts: Record<HandAccountName, BookkeepingAccount>,
    /**
     * The first fiscal year.
     */
    fiscalYear: FiscalYear
};

function reports(): BookkeepingReportServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
}

function reportPdfs(): BookkeepingReportPdfServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE);
}

function accounts(): Repository<BookkeepingAccount, BookkeepingAccountCreateData> {
    return inject(repositoryTokenFor(BookkeepingAccount));
}

/**
 * Starts the books of a new tenant posted by hand, with every account of {@link HAND_ACCOUNTS}.
 * @param legalForms - The history of its legal form.
 * @param fiscalYear - Its first fiscal year.
 * @returns The books.
 */
async function createHandBooks(legalForms: BookkeepingLegalForm[], fiscalYear: NewFiscalYear): Promise<HandBooks> {
    const tenantId: string = UUIDUtilities.generate();
    return await inTenant(tenantId, async () => {
        const settings: BookkeepingSettings = await journal().createSettings({ currency: 'EUR', legalForms, company: testCompany });
        const created: BookkeepingAccount[] = await accounts().createAll(Object.values(HAND_ACCOUNTS));
        const find: (name: HandAccountName) => BookkeepingAccount = name => {
            const account: BookkeepingAccount | undefined = created.find(a => a.number === HAND_ACCOUNTS[name].number);
            if (account == undefined) {
                throw new Error(`The account ${name} was not created.`);
            }
            return account;
        };
        return {
            tenantId,
            settings,
            accounts: {
                bank: find('bank'),
                vat: find('vat'),
                suspense: find('suspense'),
                reserve: find('reserve'),
                capital: find('capital'),
                carried: find('carried'),
                allocation: find('allocation'),
                rent: find('rent'),
                revenue: find('revenue'),
                unmappedRevenue: find('unmappedRevenue')
            },
            // founded in it, unless the case says otherwise
            fiscalYear: await journal().createFiscalYear({ founded: true, ...fiscalYear })
        };
    });
}

/**
 * Posting rules naming no account.
 */
const EMPTY_RULES: PostingRules = {
    revenueAccounts: [],
    outputTaxAccounts: [],
    inputTaxAccounts: [],
    paymentDifferenceAccounts: [],
    bankAccounts: []
};

/**
 * Adds the posting rules of a fiscal year naming the accounts of the legal reserve, which the books of a UG need.
 * @param books - The books.
 * @param fiscalYear - The fiscal year.
 */
async function createReserveRules(books: HandBooks, fiscalYear: FiscalYear): Promise<void> {
    await inTenant(books.tenantId, async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).createRuleSet({
        fiscalYearId: fiscalYear.id,
        rules: {
            ...EMPTY_RULES,
            legalReserveAccountId: books.accounts.reserve.id,
            reserveAllocationAccountId: books.accounts.allocation.id
        }
    }));
}

/**
 * Posts an entry of one amount from an account to another.
 * @param books - The books.
 * @param postingDate - The day, such as `2026-03-01`.
 * @param debit - The account debited.
 * @param credit - The account credited.
 * @param amount - The amount.
 * @returns The entry.
 */
async function book(
    books: HandBooks,
    postingDate: string,
    debit: HandAccountName,
    credit: HandAccountName,
    amount: string
): Promise<JournalEntryDetails> {
    return await inTenant(books.tenantId, async () => await journal().post({
        documentDate: day(postingDate),
        postingDate: day(postingDate),
        text: `${debit} to ${credit}`,
        lines: [
            { accountId: books.accounts[debit].id, debit: new BigNumber(amount), credit: null },
            { accountId: books.accounts[credit].id, debit: null, credit: new BigNumber(amount) }
        ]
    }));
}

/**
 * Maps the accounts of the books of the postings to the positions of {@link POSITIONS}.
 * @param books - The books.
 */
async function mapAccounts(books: PostingBooks): Promise<void> {
    await inTenant(books.tenantId, async () => {
        for (const [name, positions] of ObjectUtilities.entries(POSITIONS)) {
            await accounts().updateById(books.accounts[name].id, positions);
        }
    });
}

/**
 * Seeds the year 2026 of new books, whose reports the cases calculated by hand: the share capital of 25,000.00, an
 * invoice of 1,000.00 and one of 500.00 at 19 %, a credit note of 200.00 of the second, an expense of 100.00 and 19.00
 * VAT, the payments of the first invoice and of the expense, and the rent of May booked wrong, reversed and booked
 * again.
 * @returns The books.
 */
export async function createSeededBooks(): Promise<PostingBooks> {
    const books: PostingBooks = await createPostingBooks();
    await mapAccounts(books);
    await inTenant(books.tenantId, async () => await journal().post({
        documentDate: day('2026-01-02'),
        postingDate: day('2026-01-02'),
        documentReference: 'Notary 2026-1',
        text: 'Share capital',
        lines: [
            { accountId: books.accounts.bank.id, debit: new BigNumber('25000.00'), credit: null },
            { accountId: books.accounts.capital.id, debit: null, credit: new BigNumber('25000.00') }
        ]
    }));
    await issueInvoice(books, '2026-SIEMEN-0001', [itemOf(1000)]);
    const second: Invoice = await issueInvoice(books, '2026-SIEMEN-0002', [itemOf(500)]);
    await inTenant(books.tenantId, async () => {
        const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
        );
        await cancellations.createCreditNote(second.id, [itemOf(200)], { date: new Date('2026-04-01T12:00:00.000Z') });
    });
    await inTenant(books.tenantId, async () => {
        const expenses: ExpenseServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
        await expenses.recordExpense((await expenses.createExpense(rentOf(books))).id);
    });
    await suggest(books, await createTransaction(books, '1190', {
        counterpartyName: 'SIEMENS AG',
        counterpartyIban: 'DE02100500000054540402',
        remittanceInformation: 'Invoice 2026-SIEMEN-0001'
    }));
    await suggest(books, await createTransaction(books, '-119', {
        counterpartyName: 'OFFICE SUPPLIES GMBH',
        counterpartyIban: 'DE02100500000054540402',
        remittanceInformation: 'R-77'
    }));
    await inTenant(books.tenantId, async () => {
        const rent: (postingDate: string, amount: string) => Promise<JournalEntryDetails> = async (postingDate, amount) => await journal()
            .post({
                documentDate: day(postingDate),
                postingDate: day(postingDate),
                documentReference: 'L-2026-05',
                text: 'Rent May',
                lines: [
                    { accountId: books.accounts.rent.id, debit: new BigNumber(amount), credit: null },
                    { accountId: books.accounts.bank.id, debit: null, credit: new BigNumber(amount) }
                ]
            });
        const wrong: JournalEntryDetails = await rent('2026-05-01', '300.00');
        await journal().reverse(wrong.entry.id, { postingDate: day('2026-05-02'), text: 'Wrong amount' });
        await rent('2026-05-03', '250.00');
    });
    return books;
}

/**
 * The amounts of a statement that are not zero, by the ids of their positions, in two decimals.
 * @param statement - The statement.
 * @returns The amounts.
 */
function amountsOf(statement: BookkeepingStatement): Record<string, string> {
    return Object.fromEntries(statement.positions.filter(p => !p.amount.isZero()).map(p => [p.id, p.amount.toFixed(2)]));
}

/**
 * What each position of a shortened structure adds up to, from the amounts of the full statement: the sums it names,
 * and the positions below it.
 * @param structure - The shortened structure.
 * @param full - The full statement.
 * @returns The amounts that are not zero, by id, in two decimals.
 */
function rolledUpAmountsOf(structure: BookkeepingStatementStructure, full: BookkeepingStatement): Record<string, string> {
    const fullAmounts: Map<string, BigNumber> = new Map(full.positions.map(p => [p.id, p.amount]));
    const res: Record<string, string> = {};
    const visit: (position: BookkeepingStatementStructure['positions'][number]) => BigNumber = position => {
        const amount: BigNumber = [
            ...(position.sums ?? []).map(id => fullAmounts.get(id) ?? new BigNumber(0)),
            ...(position.positions ?? []).map(visit)
        ].reduce((sum, part) => NumberUtilities.add(sum, part), new BigNumber(0));
        if (!amount.isZero()) {
            res[position.id] = amount.toFixed(2);
        }
        return amount;
    };
    for (const position of structure.positions) {
        visit(position);
    }
    return res;
}

/**
 * Reads the first bytes of a pdf.
 * @param doc - The pdf.
 * @returns Its first 5 characters, `%PDF-` for a pdf.
 */
async function readHeader(doc: Readable): Promise<string> {
    return (await buffer(doc)).subarray(0, 5).toString();
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeBookkeepingReports(dataSourceName: string): void {
    describe(`the reports of the books on ${dataSourceName}`, () => {
        describe('of a seeded year', () => {
            it('answer the journal, the ledger, the trial balance and the revenue to the cent', async () => {
                const books: PostingBooks = await createSeededBooks();

                await inTenant(books.tenantId, async () => {
                    const journalReport: BookkeepingJournalReport = await reports()
                        .resolveJournal(day('2026-01-01'), day('2026-12-31'));
                    expect(journalReport.entries.map(e => [e.entry.postingDate.toISOString().slice(0, 10), e.entry.text])).toEqual([
                        ['2026-01-02', 'Share capital'],
                        ['2026-03-01', 'Invoice 2026-SIEMEN-0001'],
                        ['2026-03-01', 'Invoice 2026-SIEMEN-0002'],
                        ['2026-03-05', 'Expense R-77 of Office Supplies GmbH'],
                        ['2026-03-20', 'Payment of the invoice 2026-SIEMEN-0001'],
                        ['2026-03-20', expect.stringContaining('R-77')],
                        ['2026-04-01', expect.stringContaining('2026-SIEMEN-0002')],
                        ['2026-05-01', 'Rent May'],
                        ['2026-05-02', 'Wrong amount'],
                        ['2026-05-03', 'Rent May']
                    ]);
                    expect([journalReport.debit.toFixed(2), journalReport.credit.toFixed(2)]).toEqual(['29301.00', '29301.00']);
                    expect(journalReport.entries.every(e => e.lines.length >= 2)).toBe(true);

                    const ledger: BookkeepingLedgerReport = await reports()
                        .resolveLedger(books.accounts.bank.id, day('2026-03-01'), day('2026-05-31'));
                    expect(ledger.openingBalance.toFixed(2)).toBe('25000.00');
                    expect(ledger.lines.map(l => [
                        l.postingDate.toISOString().slice(0, 10),
                        l.debit?.toFixed(2) ?? null,
                        l.credit?.toFixed(2) ?? null,
                        l.balance.toFixed(2)
                    ])).toEqual([
                        ['2026-03-20', '1190.00', null, '26190.00'],
                        ['2026-03-20', null, '119.00', '26071.00'],
                        ['2026-05-01', null, '300.00', '25771.00'],
                        ['2026-05-02', '300.00', null, '26071.00'],
                        ['2026-05-03', null, '250.00', '25821.00']
                    ]);
                    expect([ledger.debit.toFixed(2), ledger.credit.toFixed(2), ledger.closingBalance.toFixed(2)])
                        .toEqual(['1490.00', '669.00', '25821.00']);

                    const trialBalance: BookkeepingTrialBalance = await reports()
                        .resolveTrialBalance(books.fiscalYear.id, undefined);
                    expect(trialBalance.rows.map(r => [r.account.number, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]))
                        .toEqual([
                            ['1200', '26490.00', '669.00', '25821.00'],
                            ['1400', '1785.00', '1428.00', '357.00'],
                            ['1576', '19.00', '0.00', '19.00'],
                            ['1600', '119.00', '119.00', '0.00'],
                            ['1776', '38.00', '285.00', '-247.00'],
                            ['2900', '0.00', '25000.00', '-25000.00'],
                            ['4210', '650.00', '300.00', '350.00'],
                            ['8400', '200.00', '1500.00', '-1300.00']
                        ]);
                    expect([trialBalance.debit, trialBalance.credit, trialBalance.debitBalances, trialBalance.creditBalances]
                        .map(a => a.toFixed(2)))
                        .toEqual(['29301.00', '29301.00', '26547.00', '26547.00']);
                    const march: BookkeepingTrialBalance = await reports()
                        .resolveTrialBalance(books.fiscalYear.id, day('2026-03-31'));
                    expect([march.debit.toFixed(2), march.credit.toFixed(2)]).toEqual(['28213.00', '28213.00']);
                    await expect(reports().resolveTrialBalance(books.fiscalYear.id, day('2027-01-01')))
                        .rejects.toThrow('The until needs to be a day of the fiscal year from 2026-01-01 to 2026-12-31.');

                    const revenue: BookkeepingRevenueReport = await reports().resolveRevenue(2026);
                    expect(revenue.accounts.map(a => [a.number, a.amount.toFixed(2)])).toEqual([['8400', '1300.00']]);
                    expect(revenue.total.toFixed(2)).toBe('1300.00');
                    expect((await reports().resolveRevenue(2025)).total.toFixed(2)).toBe('0.00');
                });
            });

            it('answer the balance sheet and the income statement in every form, balanced and rolled up from the full one', async () => {
                const books: PostingBooks = await createSeededBooks();

                await inTenant(books.tenantId, async () => {
                    const balanceSheet: BookkeepingStatement = await reports()
                        .resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id);
                    expect(amountsOf(balanceSheet)).toEqual({
                        assets: '26197.00',
                        'assets.B': '26197.00',
                        'assets.B.II': '376.00',
                        'assets.B.II.1': '357.00',
                        'assets.B.II.4': '19.00',
                        'assets.B.IV': '25821.00',
                        'equity-and-liabilities': '26197.00',
                        'equity-and-liabilities.A': '25950.00',
                        'equity-and-liabilities.A.I': '25000.00',
                        'equity-and-liabilities.A.V': '950.00',
                        'equity-and-liabilities.C': '247.00',
                        'equity-and-liabilities.C.8': '247.00'
                    });
                    expect(balanceSheet).toMatchObject({
                        type: 'BALANCE_SHEET',
                        form: 'hgb.balance-sheet',
                        label: 'Balance sheet',
                        closed: false,
                        unmapped: []
                    });
                    expect(balanceSheet.result.toFixed(2)).toBe('950.00');
                    // the input tax on the left by its debit, the output tax on the right by its credit
                    expect(balanceSheet.positions.find(p => p.id === 'equity-and-liabilities.C.8')?.accounts
                        .map(a => [a.number, a.amount.toFixed(2)]))
                        .toEqual([['1776', '247.00']]);
                    expect(balanceSheet.positions.find(p => p.id === 'assets.B.II.4')?.accounts.map(a => [a.number, a.amount.toFixed(2)]))
                        .toEqual([['1576', '19.00']]);

                    const incomeStatement: BookkeepingStatement = await reports()
                        .resolveIncomeStatement(books.fiscalYear.id, HGB_INCOME_STATEMENT.id);
                    expect(amountsOf(incomeStatement)).toEqual({
                        'income-statement.1': '1300.00',
                        'income-statement.8': '-350.00',
                        'income-statement.15': '950.00',
                        'income-statement.17': '950.00'
                    });
                    expect(incomeStatement.result.toFixed(2)).toBe('950.00');

                    for (const structure of [HGB_SMALL_BALANCE_SHEET, HGB_MICRO_BALANCE_SHEET]) {
                        const shortened: BookkeepingStatement = await reports().resolveBalanceSheet(books.fiscalYear.id, structure.id);
                        expect(amountsOf(shortened)).toEqual(rolledUpAmountsOf(structure, balanceSheet));
                    }
                    const micro: BookkeepingStatement = await reports()
                        .resolveIncomeStatement(books.fiscalYear.id, HGB_MICRO_INCOME_STATEMENT.id);
                    expect(amountsOf(micro)).toEqual({
                        'micro-income-statement.1': '1300.00',
                        'micro-income-statement.6': '-350.00',
                        'micro-income-statement.8': '950.00'
                    });
                    expect(amountsOf(micro)).toEqual(rolledUpAmountsOf(HGB_MICRO_INCOME_STATEMENT, incomeStatement));
                    expect(amountsOf(await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_SMALL_BALANCE_SHEET.id))).toMatchObject({
                        'assets.B.II': '376.00',
                        'equity-and-liabilities.A.V': '950.00'
                    });

                    await expect(reports().resolveBalanceSheet(books.fiscalYear.id, HGB_INCOME_STATEMENT.id))
                        .rejects.toThrow(BadRequestError);
                    await expect(reports().resolveIncomeStatement(books.fiscalYear.id, 'hgb.unknown'))
                        .rejects.toThrow('The form "hgb.unknown" needs to be a statement structure of the type INCOME_STATEMENT in '
                            + 'ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES.');
                });
            });

            it('carry the result into equity at closing, and answer the statements of the closed year the same every time', async () => {
                const books: PostingBooks = await createSeededBooks();

                await inTenant(books.tenantId, async () => {
                    await journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 2 });
                    const open: BookkeepingStatement[] = [
                        await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id),
                        await reports().resolveIncomeStatement(books.fiscalYear.id, HGB_INCOME_STATEMENT.id)
                    ];

                    const next: FiscalYear = (await journal()
                        .closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id })).nextFiscalYear;

                    const closed: () => Promise<unknown[]> = async () => [
                        await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id),
                        await reports().resolveIncomeStatement(books.fiscalYear.id, HGB_INCOME_STATEMENT.id),
                        await reports().resolveBalanceSheet(books.fiscalYear.id, undefined),
                        await reports().resolveTrialBalance(books.fiscalYear.id, undefined),
                        await reports().resolveJournal(day('2026-01-01'), day('2026-12-31')),
                        await reports().resolveLedger(books.accounts.bank.id, day('2026-01-01'), day('2026-12-31'))
                    ];
                    const first: unknown[] = await closed();
                    expect(await closed()).toEqual(first);
                    // the statements of the year read the same before the closing as after it
                    expect(first.slice(0, 2)).toEqual(open.map(statement => ({ ...statement, closed: true })));
                    // two employees and a balance sheet total of 26,197.00: a micro corporation
                    expect(first[2]).toMatchObject({ form: HGB_MICRO_BALANCE_SHEET.id });

                    const opened: BookkeepingStatement = await reports().resolveBalanceSheet(next.id, HGB_BALANCE_SHEET.id);
                    expect(amountsOf(opened)).toMatchObject({
                        'equity-and-liabilities.A': '25950.00',
                        'equity-and-liabilities.A.I': '25000.00',
                        'equity-and-liabilities.A.IV': '950.00',
                        assets: '26197.00'
                    });
                    // the equity grew by the share capital paid in and by the result of the income statement
                    const equity: (statement: BookkeepingStatement) => BigNumber = statement => statement.positions
                        .find(p => p.id === 'equity-and-liabilities.A')?.amount ?? new BigNumber(0);
                    expect(NumberUtilities.subtract(equity(opened), new BigNumber('25000.00')).toFixed(2)).toBe(open[1]?.result.toFixed(2));

                    await expect(journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 3 }))
                        .rejects.toThrow('The fiscal year from 2026-01-01 to 2026-12-31 is closed, and stays as it was closed.');
                });
            });

            it('answer a closed year from its archive, whatever the accounts are mapped to since, '
                + 'with the figures of the year before', async () => {
                const books: PostingBooks = await createSeededBooks();

                await inTenant(books.tenantId, async () => {
                    await journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 2 });
                    const open: BookkeepingStatement = await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id);
                    // the first fiscal year of the books, without figures of a year before
                    expect(open).toMatchObject({ previousFiscalYearId: null, previousEnd: null });
                    expect(open.positions.every(p => p.previousAmount === null)).toBe(true);

                    const next: FiscalYear = (await journal()
                        .closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id })).nextFiscalYear;

                    const archived: FiscalYearStatement[] = await inject<Repository<FiscalYearStatement>>(
                        repositoryTokenFor(FiscalYearStatement)
                    ).findAll({ where: { fiscalYearId: books.fiscalYear.id }, limit: 'all' });
                    expect(archived.map(s => [s.type, s.form, s.applies]).sort()).toEqual([
                        [BookkeepingStatementType.BALANCE_SHEET, HGB_BALANCE_SHEET.id, false],
                        [BookkeepingStatementType.BALANCE_SHEET, HGB_MICRO_BALANCE_SHEET.id, true],
                        [BookkeepingStatementType.INCOME_STATEMENT, HGB_INCOME_STATEMENT.id, false],
                        [BookkeepingStatementType.INCOME_STATEMENT, HGB_MICRO_INCOME_STATEMENT.id, true]
                    ]);

                    // the receivables mapped to another position once the year is closed
                    await accounts().updateById(books.accounts.receivables.id, { statementPosition: 'assets.B.II.4' });

                    expect(await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id))
                        .toEqual({ ...open, closed: true });
                    // a form not archived adds up the archived full one
                    expect(amountsOf(await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_SMALL_BALANCE_SHEET.id)))
                        .toEqual(rolledUpAmountsOf(HGB_SMALL_BALANCE_SHEET, open));
                    const following: BookkeepingStatement = await reports().resolveBalanceSheet(next.id, HGB_BALANCE_SHEET.id);
                    // the open year follows the new mapping, and states the closed one as it was archived
                    expect(amountsOf(following)).toMatchObject({ 'assets.B.II.4': '376.00' });
                    expect(amountsOf(following)['assets.B.II.1']).toBeUndefined();
                    expect(following).toMatchObject({ previousFiscalYearId: books.fiscalYear.id, previousEnd: day('2026-12-31') });
                    const previous: Record<string, string> = Object.fromEntries(following.positions
                        .filter(p => p.previousAmount != undefined && !p.previousAmount.isZero())
                        .map(p => [p.id, p.previousAmount?.toFixed(2) ?? '']));
                    expect(previous).toEqual(amountsOf(open));
                    const income: BookkeepingStatement = await reports().resolveIncomeStatement(next.id, HGB_MICRO_INCOME_STATEMENT.id);
                    expect(income.positions.find(p => p.id === 'micro-income-statement.8')?.previousAmount?.toFixed(2)).toBe('950.00');

                    // the pdf archived at the closing is the one served
                    const closedYear: FiscalYear = await inject<Repository<FiscalYear>>(repositoryTokenFor(FiscalYear))
                        .findById(books.fiscalYear.id);
                    const row: FiscalYearStatement | undefined = await reports()
                        .findArchivedStatement(closedYear, BookkeepingStatementType.BALANCE_SHEET, undefined);
                    if (row == undefined) {
                        throw new Error('The balance sheet is not archived.');
                    }
                    const stored: Buffer = await buffer(await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(row, row.file));
                    const served: Buffer = await buffer(await reportPdfs().resolveBalanceSheetPdf(books.fiscalYear.id, undefined));
                    expect(stored.subarray(0, 5).toString()).toBe('%PDF-');
                    expect(served.equals(stored)).toBe(true);
                });
            });

            it('never include the entries of another tenant', async () => {
                const books: PostingBooks = await createSeededBooks();
                const other: PostingBooks = await createSeededBooks();

                const [mine, theirs] = await Promise.all([books, other].map(async b => await inTenant(b.tenantId, async () => [
                    await reports().resolveJournal(day('2026-01-01'), day('2026-12-31')),
                    await reports().resolveTrialBalance(b.fiscalYear.id, undefined)
                ] as const)));

                expect(mine?.[0].entries.map(e => e.entry.tenantId)).toEqual(Array.from({ length: 10 }, () => books.tenantId));
                expect(theirs?.[0].entries.every(e => e.entry.tenantId === other.tenantId)).toBe(true);
                expect(mine?.[1].debit.toFixed(2)).toBe('29301.00');
                await expect(inTenant(
                    books.tenantId,
                    async () => await reports().resolveLedger(other.accounts.bank.id, day('2026-01-01'), day('2026-12-31'))
                )).rejects.toThrow(NotFoundError);
                await expect(inTenant(books.tenantId, async () => await reports().resolveBalanceSheet(other.fiscalYear.id, undefined)))
                    .rejects.toThrow(NotFoundError);
            });
        });

        describe('mapping accounts to positions', () => {
            it('report an account with a balance and no position as unmapped, '
                + 'and an account in the position of the side of its balance', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01') }
                );
                await book(books, '2026-01-02', 'bank', 'capital', '1000.00');
                await book(books, '2026-02-01', 'rent', 'bank', '3000.00');
                await book(books, '2026-02-02', 'vat', 'bank', '50.00');
                await book(books, '2026-02-03', 'suspense', 'bank', '200.00');
                await book(books, '2026-02-04', 'bank', 'unmappedRevenue', '500.00');

                await inTenant(books.tenantId, async () => {
                    const overdrawn: BookkeepingStatement = await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id);
                    expect(amountsOf(overdrawn)).toMatchObject({
                        'assets.B.II.4': '50.00',
                        'equity-and-liabilities.C.2': '1750.00',
                        'equity-and-liabilities.A.I': '1000.00',
                        'equity-and-liabilities.A.V': '-2500.00'
                    });
                    expect(amountsOf(overdrawn)['assets.B.IV']).toBeUndefined();
                    expect(overdrawn.unmapped.map(a => [a.number, a.amount.toFixed(2)])).toEqual([['1590', '200.00']]);
                    const incomeStatement: BookkeepingStatement = await reports()
                        .resolveIncomeStatement(books.fiscalYear.id, HGB_INCOME_STATEMENT.id);
                    expect(incomeStatement.unmapped.map(a => [a.number, a.amount.toFixed(2)])).toEqual([['8999', '500.00']]);
                    // the result counts the revenue without a position all the same
                    expect(incomeStatement.result.toFixed(2)).toBe('-2500.00');
                });

                await book(books, '2026-03-01', 'bank', 'capital', '5000.00');
                await book(books, '2026-03-02', 'bank', 'vat', '80.00');

                await inTenant(books.tenantId, async () => {
                    const balanceSheet: BookkeepingStatement = await reports()
                        .resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id);
                    expect(amountsOf(balanceSheet)).toMatchObject({ 'assets.B.IV': '3330.00', 'equity-and-liabilities.C.8': '30.00' });
                    expect(amountsOf(balanceSheet)['equity-and-liabilities.C.2']).toBeUndefined();
                    expect(amountsOf(balanceSheet)['assets.B.II.4']).toBeUndefined();
                });
            });

            it('refuse a position no full structure has, one with positions below it or one of the other statement', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01') }
                );
                const create: (data: Partial<BookkeepingAccountCreateData>) => Promise<BookkeepingAccount> = async data => await inTenant(
                    books.tenantId,
                    async () => await accounts().create({
                        number: '1000',
                        name: 'Cash',
                        type: BookkeepingAccountType.ASSET,
                        statementPosition: null,
                        creditStatementPosition: null,
                        ...data
                    })
                );

                await expect(create({ statementPosition: 'assets.Z' })).rejects.toThrow(BadRequestError);
                await expect(create({ statementPosition: 'assets.Z' }))
                    .rejects.toThrow('The statementPosition "assets.Z" needs to be a position of a full statement '
                        + 'without positions below it, such as assets.B.IV.');
                await expect(create({ statementPosition: 'assets.B.II' })).rejects.toThrow(BadRequestError);
                await expect(create({ statementPosition: 'micro-income-statement.1', type: BookkeepingAccountType.REVENUE }))
                    .rejects.toThrow(BadRequestError);
                await expect(create({ statementPosition: 'income-statement.15', type: BookkeepingAccountType.REVENUE }))
                    .rejects.toThrow(BadRequestError);
                await expect(create({ statementPosition: 'income-statement.1' }))
                    .rejects.toThrow('The statementPosition "income-statement.1" of an asset, liability or equity account '
                        + 'needs to be a position of a balance sheet.');
                await expect(create({ type: BookkeepingAccountType.EXPENSE, creditStatementPosition: 'assets.B.IV' }))
                    .rejects.toThrow('The creditStatementPosition "assets.B.IV" of a revenue or expense account '
                        + 'needs to be a position of an income statement.');
                await expect(inTenant(
                    books.tenantId,
                    async () => await accounts().updateById(books.accounts.suspense.id, { statementPosition: 'assets.B' })
                )).rejects.toThrow(BadRequestError);
                await expect(inTenant(
                    books.tenantId,
                    async () => await accounts().updateById(books.accounts.rent.id, { type: BookkeepingAccountType.ASSET })
                )).rejects.toThrow(BadRequestError);

                const cash: BookkeepingAccount = await create({ statementPosition: 'assets.B.IV' });
                expect(cash.statementPosition).toBe('assets.B.IV');
            });
        });

        describe('the size class of a corporation by the HGB', () => {
            it('resolves the forms of a micro corporation and of a small one', async () => {
                const micro: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 5 }
                );
                const small: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 11 }
                );
                await book(micro, '2026-03-01', 'bank', 'revenue', '100000.00');
                await book(small, '2026-03-01', 'bank', 'revenue', '1000000.00');

                expect(await inTenant(micro.tenantId, async () => await reports().resolveStatementForms(micro.fiscalYear.id)))
                    .toEqual({ balanceSheet: HGB_MICRO_BALANCE_SHEET.id, incomeStatement: HGB_MICRO_INCOME_STATEMENT.id });
                expect(await inTenant(small.tenantId, async () => await reports().resolveStatementForms(small.fiscalYear.id)))
                    .toEqual({ balanceSheet: HGB_SMALL_BALANCE_SHEET.id, incomeStatement: HGB_INCOME_STATEMENT.id });
                const microSheet: BookkeepingStatement = await inTenant(
                    micro.tenantId,
                    async () => await reports().resolveBalanceSheet(micro.fiscalYear.id, undefined)
                );
                expect(microSheet.form).toBe(HGB_MICRO_BALANCE_SHEET.id);
                expect(amountsOf(microSheet)).toEqual({
                    assets: '100000.00',
                    'assets.B': '100000.00',
                    'equity-and-liabilities': '100000.00',
                    'equity-and-liabilities.A': '100000.00'
                });
                const smallStatement: BookkeepingStatement = await inTenant(
                    small.tenantId,
                    async () => await reports().resolveIncomeStatement(small.fiscalYear.id, undefined)
                );
                expect(smallStatement.form).toBe(HGB_INCOME_STATEMENT.id);
            });

            it('lists every form a fiscal year can be shown in, with the one that applies, '
                + 'and the archived one once it is closed', async () => {
                const small: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 11 }
                );
                await book(small, '2026-03-01', 'bank', 'revenue', '1000000.00');
                const balanceSheetForms: BookkeepingStatementForm[] = [
                    { id: HGB_BALANCE_SHEET.id, name: 'Balance sheet (§ 266 HGB)' },
                    { id: HGB_SMALL_BALANCE_SHEET.id, name: 'Shortened balance sheet of a small corporation (§ 266 (1) sentence 3 HGB)' },
                    { id: HGB_MICRO_BALANCE_SHEET.id, name: 'Shortened balance sheet of a micro corporation (§ 266 (1) sentence 4 HGB)' }
                ];
                const incomeStatementForms: BookkeepingStatementForm[] = [
                    { id: HGB_INCOME_STATEMENT.id, name: 'Income statement by the nature of expense method (§ 275 (2) HGB)' },
                    { id: HGB_MICRO_INCOME_STATEMENT.id, name: 'Shortened income statement of a micro corporation (§ 275 (5) HGB)' }
                ];
                const expected: BookkeepingStatementFormChoices = {
                    fiscalYearId: small.fiscalYear.id,
                    balanceSheet: { applies: HGB_SMALL_BALANCE_SHEET.id, forms: balanceSheetForms },
                    incomeStatement: { applies: HGB_INCOME_STATEMENT.id, forms: incomeStatementForms }
                };

                await inTenant(small.tenantId, async () => {
                    expect(await reports().resolveStatementFormChoices(small.fiscalYear.id)).toEqual(expected);
                    await journal().closeFiscalYear(small.fiscalYear.id, { resultAccountId: small.accounts.carried.id });
                    // answered from the archive of the closing, as the statements of the year are
                    expect(await reports().resolveStatementFormChoices(small.fiscalYear.id)).toEqual(expected);
                    await expect(reports().resolveStatementFormChoices(UUIDUtilities.generate())).rejects.toThrow(NotFoundError);
                });
            });

            it('changes the size class only once a limit is crossed on two consecutive balance sheet dates', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2025-01-01'), averageEmployees: 5 }
                );
                const years: FiscalYear[] = await inTenant(books.tenantId, async () => [
                    books.fiscalYear,
                    await journal().createFiscalYear({ averageEmployees: 11 }),
                    await journal().createFiscalYear({ averageEmployees: 11 }),
                    await journal().createFiscalYear({ averageEmployees: 3 })
                ]);
                await book(books, '2025-03-01', 'bank', 'revenue', '100000.00');
                await book(books, '2026-03-01', 'bank', 'revenue', '1000000.00');
                await book(books, '2027-03-01', 'bank', 'revenue', '1000000.00');
                await book(books, '2028-03-01', 'bank', 'revenue', '100000.00');

                const classes: HgbSizeClass[] = await inTenant(books.tenantId, async () => {
                    const service: HgbCorporationConformanceService = inject(HgbCorporationConformanceService);
                    const res: HgbSizeClass[] = [];
                    for (const year of years) {
                        res.push(await service.resolveSizeClass(year));
                    }
                    return res;
                });

                // above the limits of a micro corporation in 2026 and 2027, below them again in 2028 alone
                expect(classes).toEqual([HgbSizeClass.MICRO, HgbSizeClass.MICRO, HgbSizeClass.SMALL, HgbSizeClass.SMALL]);
            });

            it('refuses the size class of a fiscal year without its average number of employees, and its closing', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01') }
                );
                await book(books, '2026-03-01', 'bank', 'revenue', '1000.00');

                await inTenant(books.tenantId, async () => {
                    const message: string = 'The fiscal year from 2026-01-01 to 2026-12-31 needs its averageEmployees, '
                        + 'the average number of employees the size class of § 267 HGB is resolved by.';
                    await expect(reports().resolveStatementForms(books.fiscalYear.id)).rejects.toThrow(ConflictError);
                    await expect(reports().resolveBalanceSheet(books.fiscalYear.id, undefined)).rejects.toThrow(message);
                    await expect(journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.carried.id }))
                        .rejects.toThrow(message);
                    // a form named is answered without it
                    expect((await reports().resolveBalanceSheet(books.fiscalYear.id, HGB_BALANCE_SHEET.id)).form)
                        .toBe(HGB_BALANCE_SHEET.id);

                    await journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 0 });
                    expect((await reports().resolveStatementForms(books.fiscalYear.id)).balanceSheet).toBe(HGB_MICRO_BALANCE_SHEET.id);
                });
            });

            it('classifies the first fiscal year of the books by the size class before it, or as founded, '
                + 'and refuses it without either', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 1, founded: null }
                );
                await book(books, '2026-03-01', 'bank', 'revenue', '1000.00');

                await inTenant(books.tenantId, async () => {
                    const message: string = 'The first fiscal year of the books, from 2026-01-01 to 2026-12-31, needs either founded, '
                        + 'when the company was founded in it, or its previousSizeClass, one of MICRO, SMALL, MEDIUM, LARGE.';
                    await expect(reports().resolveStatementForms(books.fiscalYear.id)).rejects.toThrow(message);
                    await expect(journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.carried.id }))
                        .rejects.toThrow(message);

                    // the figures of a micro corporation, after a balance sheet date of a small one: a change takes two
                    await journal().updateFiscalYear(books.fiscalYear.id, { previousSizeClass: HgbSizeClass.SMALL });
                    expect(await reports().resolveStatementForms(books.fiscalYear.id))
                        .toEqual({ balanceSheet: HGB_SMALL_BALANCE_SHEET.id, incomeStatement: HGB_INCOME_STATEMENT.id });
                    await journal().updateFiscalYear(books.fiscalYear.id, { founded: true });
                    await expect(reports().resolveStatementForms(books.fiscalYear.id)).rejects.toThrow(message);
                    await journal().updateFiscalYear(books.fiscalYear.id, { previousSizeClass: null });
                    expect((await reports().resolveStatementForms(books.fiscalYear.id)).balanceSheet).toBe(HGB_MICRO_BALANCE_SHEET.id);
                    await journal().updateFiscalYear(books.fiscalYear.id, { founded: null, previousSizeClass: 'HUGE' });
                    await expect(reports().resolveStatementForms(books.fiscalYear.id)).rejects.toThrow(message);
                });
            });
        });

        describe('what the conformances of a corporation need', () => {
            it('refuse the settings of a corporation without its company and register, '
                + 'and take those of another legal form without', async () => {
                const tenantId: string = UUIDUtilities.generate();

                await inTenant(tenantId, async () => {
                    await expect(journal().createSettings({
                        currency: 'EUR',
                        legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }]
                    })).rejects.toThrow('The bookkeeping settings of a GmbH need the name, seat, registerCourt, registerNumber '
                        + 'of its company, § 264 (1a) HGB.');
                    await expect(journal().createSettings({
                        currency: 'EUR',
                        legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                        company: { name: 'Acme GmbH', seat: 'Berlin' }
                    })).rejects.toThrow(BadRequestError);
                    const settings: BookkeepingSettings = await journal().createSettings({
                        currency: 'EUR',
                        legalForms: [{ legalForm: 'e.K.', validFrom: day('2020-01-01') }]
                    });
                    expect(settings.company).toBeNull();

                    // a UG from 2027, whose register is needed from then
                    await expect(journal().updateSettings({ legalForm: { legalForm: 'UG', validFrom: day('2027-01-01') } }))
                        .rejects.toThrow('The bookkeeping settings of a UG need the name, seat, registerCourt, registerNumber '
                            + 'of its company, § 264 (1a) HGB.');
                    await journal().updateSettings({ company: testCompany });
                    const changed: BookkeepingSettings = await journal()
                        .updateSettings({ legalForm: { legalForm: 'UG', validFrom: day('2027-01-01') } });
                    expect(changed.company).toEqual(testCompany);
                    await expect(journal().updateSettings({ company: null })).rejects.toThrow(BadRequestError);
                });
            });

            it('refuse posting rules of a UG without the accounts of its legal reserve, '
                + 'and a UG from within an open year whose rules lack them', async () => {
                const ug: HandBooks = await createHandBooks(
                    [{ legalForm: 'UG', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01') }
                );
                const gmbh: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01') }
                );
                const message: string = 'The posting rules of the fiscal year from 2026-01-01 to 2026-12-31 need to name the '
                    + 'legalReserveAccountId and the reserveAllocationAccountId of the legal reserve of § 5a (3) GmbHG.';

                await expect(inTenant(
                    ug.tenantId,
                    async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).createRuleSet({
                        fiscalYearId: ug.fiscalYear.id,
                        rules: EMPTY_RULES
                    })
                )).rejects.toThrow(message);
                await createReserveRules(ug, ug.fiscalYear);

                await inTenant(gmbh.tenantId, async () => {
                    await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE)
                        .createRuleSet({ fiscalYearId: gmbh.fiscalYear.id, rules: EMPTY_RULES });
                    await expect(journal().updateSettings({ legalForm: { legalForm: 'UG', validFrom: day('2026-06-01') } }))
                        .rejects.toThrow(message);
                    expect((await journal().findSettings())?.legalForms.map(f => f.legalForm)).toEqual(['GmbH']);
                });
            });
        });

        describe('the legal reserve of a UG', () => {
            it('is proposed as a quarter of the net income less the loss carried forward, '
                + 'and the closing is refused until it is posted', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'UG', validFrom: day('2020-01-01') }],
                    { start: day('2025-01-01'), averageEmployees: 1 }
                );
                await createReserveRules(books, books.fiscalYear);
                await book(books, '2025-01-02', 'bank', 'capital', '1000.00');
                await book(books, '2025-06-01', 'rent', 'bank', '2000.00');
                const next: FiscalYear = await inTenant(books.tenantId, async () => {
                    // a loss: nothing to reserve
                    expect(await journal().resolveClosingProposals(books.fiscalYear.id)).toEqual([]);
                    const closed: FiscalYear = (await journal()
                        .closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.carried.id })).nextFiscalYear;
                    return await journal().updateFiscalYear(closed.id, { averageEmployees: 1 });
                });
                await book(books, '2026-03-01', 'bank', 'revenue', '10000.10');

                await inTenant(books.tenantId, async () => {
                    const proposals: BookkeepingClosingProposal[] = await journal().resolveClosingProposals(next.id);

                    // a quarter of 10,000.10 less the loss of 2,000.00 carried forward, 2,000.025, rounded up
                    expect(proposals).toHaveLength(1);
                    expect(proposals[0]?.conformance).toBe('ug-legal-reserve');
                    expect(proposals[0]?.entry).toMatchObject({ postingDate: day('2026-12-31'), text: 'Legal reserve of § 5a (3) GmbHG' });
                    expect(proposals[0]?.entry.lines.map(l => [l.accountId, l.debit?.toFixed(2) ?? null, l.credit?.toFixed(2) ?? null]))
                        .toEqual([
                            [books.accounts.allocation.id, '2000.03', null],
                            [books.accounts.reserve.id, null, '2000.03']
                        ]);
                    await expect(journal().closeFiscalYear(next.id, { resultAccountId: books.accounts.carried.id }))
                        .rejects.toThrow(ConflictError);
                    await expect(journal().closeFiscalYear(next.id, { resultAccountId: books.accounts.carried.id }))
                        .rejects.toThrow('The legal reserve of § 5a (3) GmbHG needs 2000.03 EUR more on the account 0846 '
                            + 'before the fiscal year is closed.');

                    const entry: BookkeepingClosingProposal['entry'] | undefined = proposals[0]?.entry;
                    if (entry != undefined) {
                        await journal().post(entry);
                    }

                    expect(await journal().resolveClosingProposals(next.id)).toEqual([]);
                    const balanceSheet: BookkeepingStatement = await reports().resolveBalanceSheet(next.id, HGB_BALANCE_SHEET.id);
                    expect(amountsOf(balanceSheet)).toMatchObject({
                        'equity-and-liabilities.A.III.1': '2000.03',
                        'equity-and-liabilities.A.IV': '-2000.00',
                        'equity-and-liabilities.A.V': '8000.07'
                    });
                    expect((await journal().closeFiscalYear(next.id, { resultAccountId: books.accounts.carried.id })).fiscalYear.closedAt)
                        .toBeInstanceOf(Date);
                });
            });

            it('is archived with the statements of a closing that posts it in the same transaction', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'UG', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 1 }
                );
                await createReserveRules(books, books.fiscalYear);
                await book(books, '2026-03-01', 'bank', 'revenue', '10000.00');

                await inTenant(books.tenantId, async () => {
                    const [proposal] = await journal().resolveClosingProposals(books.fiscalYear.id);
                    if (proposal == undefined) {
                        throw new Error('The legal reserve was not proposed.');
                    }
                    await accounts().dataSource.runInTransaction(
                        async started => {
                            await journal().post(proposal.entry, started);
                            await journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.carried.id }, started);
                        },
                        { maxAttempts: 1 }
                    );

                    const closedYear: FiscalYear = await inject<Repository<FiscalYear>>(repositoryTokenFor(FiscalYear))
                        .findById(books.fiscalYear.id);
                    const archived: FiscalYearStatement | undefined = await reports().findArchivedStatement(
                        closedYear,
                        BookkeepingStatementType.BALANCE_SHEET,
                        HGB_BALANCE_SHEET.id
                    );
                    if (archived == undefined) {
                        throw new Error('The balance sheet was not archived.');
                    }
                    // a quarter of 10,000.00, posted to the reserve in the transaction before the closing
                    expect(archived.statement.closed).toBe(true);
                    expect(amountsOf(archived.statement)).toMatchObject({
                        'equity-and-liabilities.A.III.1': '2500.00',
                        'equity-and-liabilities.A.V': '7500.00'
                    });
                    expect(await reports().resolveBalanceSheet(closedYear.id, HGB_BALANCE_SHEET.id)).toEqual(archived.statement);
                });
            });

            it('is not proposed for a fiscal year at whose end the tenant is a GmbH', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'UG', validFrom: day('2020-01-01') }, { legalForm: 'GmbH', validFrom: day('2026-06-01') }],
                    { start: day('2026-01-01'), averageEmployees: 1 }
                );
                await book(books, '2026-03-01', 'bank', 'revenue', '10000.00');

                await inTenant(books.tenantId, async () => {
                    expect(await journal().resolveClosingProposals(books.fiscalYear.id)).toEqual([]);
                    expect((await journal()
                        .closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.carried.id })).fiscalYear.closedAt)
                        .toBeInstanceOf(Date);
                });
            });
        });

        PdfmakeTestUtilities.describeOnEvery('the pdfs of the reports', () => {
            it('render each report of a seeded year', async () => {
                const books: PostingBooks = await createSeededBooks();

                const headers: string[] = await inTenant(books.tenantId, async () => {
                    await journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 2 });
                    return [
                        await readHeader(await reportPdfs().resolveJournalPdf(day('2026-01-01'), day('2026-12-31'))),
                        await readHeader(await reportPdfs().resolveLedgerPdf(books.accounts.bank.id, day('2026-01-01'), day('2026-12-31'))),
                        await readHeader(await reportPdfs().resolveTrialBalancePdf(books.fiscalYear.id, undefined)),
                        await readHeader(await reportPdfs().resolveBalanceSheetPdf(books.fiscalYear.id, undefined)),
                        await readHeader(await reportPdfs().resolveBalanceSheetPdf(books.fiscalYear.id, HGB_BALANCE_SHEET.id)),
                        await readHeader(await reportPdfs().resolveIncomeStatementPdf(books.fiscalYear.id, undefined)),
                        await readHeader(await reportPdfs().resolveIncomeStatementPdf(books.fiscalYear.id, HGB_INCOME_STATEMENT.id)),
                        await readHeader(await reportPdfs().resolveRevenuePdf(2026))
                    ];
                });

                expect(headers).toEqual(Array.from({ length: 8 }, () => '%PDF-'));
            });

            it('add the note of the fiscal year below the balance sheet of a micro corporation, '
                + 'and none below another or without one', async () => {
                const books: HandBooks = await createHandBooks(
                    [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
                    { start: day('2026-01-01'), averageEmployees: 1 }
                );
                await book(books, '2026-03-01', 'bank', 'revenue', '1000.00');
                const noted: FiscalYear = await inTenant(books.tenantId, async () => await journal().updateFiscalYear(
                    books.fiscalYear.id,
                    { balanceSheetNote: MICRO_NOTE }
                ));

                const contentOf: (fiscalYear: FiscalYear, form: string) => Promise<PdfDocumentDefinition['content']> = async (
                    fiscalYear,
                    form
                ) => await inTenant(
                    books.tenantId,
                    async () => {
                        const statement: BookkeepingStatement = await reports().resolveBalanceSheet(books.fiscalYear.id, form);
                        const definition: PdfDocumentDefinition = { attachments: [], content: [{ text: 'Balance sheet' }] };
                        inject(HgbCorporationConformanceService).updateReportDefinition(
                            statement,
                            definition,
                            { settings: books.settings, fiscalYear, legalForm: 'GmbH' }
                        );
                        return definition.content;
                    }
                );

                expect(await contentOf(noted, HGB_MICRO_BALANCE_SHEET.id))
                    .toEqual([{ text: 'Balance sheet' }, { text: MICRO_NOTE, margin: [0, 20, 0, 0] }]);
                expect(await contentOf(noted, HGB_BALANCE_SHEET.id)).toEqual([{ text: 'Balance sheet' }]);
                // nothing to state
                expect(await contentOf(books.fiscalYear, HGB_MICRO_BALANCE_SHEET.id)).toEqual([{ text: 'Balance sheet' }]);
                const pdf: Readable = await inTenant(
                    books.tenantId,
                    async () => await reportPdfs().resolveBalanceSheetPdf(books.fiscalYear.id, undefined)
                );
                expect(await readHeader(pdf)).toBe('%PDF-');
            });
        });
    });
}