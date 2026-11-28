/* eslint-disable sonar/no-duplicate-string -- the days, amounts and messages the cases repeat are the data of each case */
import { describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { ChainGap } from '../../data-source/chain/chain-gap.model';
import { DeadlineAwareRepositoryDriver } from '../../data-source/driver/deadline-aware.repository-driver';
import { ForwardingRepositoryDriver } from '../../data-source/driver/forwarding.repository-driver';
import { RepositoryDriverInterface } from '../../data-source/driver/repository-driver.interface';
import { WriteObservingRepositoryDriver } from '../../data-source/driver/write-observing.repository-driver';
import { type PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FileRecord } from '../../file/file-record.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { getZonedDate } from '../../localization/get-zoned-date.function';
import { ZonedDate } from '../../localization/models/zoned-date.model';
import { $ts } from '../../localization/translate.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { type BookkeepingAccountFilter } from './models/bookkeeping-account-filter.model';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { BookkeepingAccount, BookkeepingAccountCreateData } from './models/bookkeeping-account.model';
import { type BookkeepingCarriedBalances } from './models/bookkeeping-carried-balances.model';
import { type BookkeepingClosingProposal } from './models/bookkeeping-closing-proposal.model';
import { type BookkeepingClosing } from './models/bookkeeping-closing.model';
import { type BookkeepingCompany } from './models/bookkeeping-company.model';
import { type BookkeepingJournalReport } from './models/bookkeeping-journal-report.model';
import { type BookkeepingPluginOptionsInput } from './models/bookkeeping-plugin-options-input.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';
import { BookkeepingStatementType } from './models/bookkeeping-statement-type.enum';
import { type BookkeepingVerification } from './models/bookkeeping-verification.model';
import { EXPENSE_RECEIPT_FILE_STORE_NAME } from './models/expense-receipt-file-store-name.model';
import { ExpenseReceipt } from './models/expense-receipt.model';
import { Expense } from './models/expense.model';
import { type FiscalYearClosingResult } from './models/fiscal-year-closing-result.model';
import { type FiscalYearReopeningResult } from './models/fiscal-year-reopening-result.model';
import { FiscalYearStatement } from './models/fiscal-year-statement.model';
import { FiscalYear } from './models/fiscal-year.model';
import { type JournalEntryDetails } from './models/journal-entry-details.model';
import { type JournalEntryFilter } from './models/journal-entry-filter.model';
import { JournalEntryLineRole } from './models/journal-entry-line-role.enum';
import { JournalEntryLine } from './models/journal-entry-line.model';
import { type JournalEntryPage } from './models/journal-entry-page.model';
import { type JournalEntryPosting } from './models/journal-entry-posting.model';
import { JournalEntry } from './models/journal-entry.model';
import { type NewJournalEntryLine } from './models/new-journal-entry-line.model';
import { type NewJournalEntry } from './models/new-journal-entry.model';
import { PostingRuleSet } from './models/posting-rule-set.model';
import { type BookkeepingConformanceServiceInterface } from './services/conformance/bookkeeping-conformance-service.interface';
import { type JournalServiceInterface } from './services/journal-service.interface';

/**
 * The cases every data source answers the same way about the books of the bookkeeping plugin. A file per data source
 * runs them, with {@link bookkeepingTestEntities}, the {@link ReceiptsFileStore}, {@link bookkeepingTestOptions} and
 * {@link bookkeepingTestConformances} registered.
 */

/**
 * The folder the receipts of the cases are kept in.
 */
export const receiptsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bookkeeping-receipts-${UUIDUtilities.generate()}`);

/**
 * The file store of the receipts of expenses, which every application keeping books registers.
 */
@FileStore()
export class ReceiptsFileStore extends FsFileStore {
    constructor() {
        super(EXPENSE_RECEIPT_FILE_STORE_NAME, receiptsFolder);
    }
}

/**
 * The entities the bookkeeping plugin needs, besides those of a test server.
 */
export const bookkeepingTestEntities: Newable<BaseEntity>[] = [
    FileRecord,
    ChainGap,
    BookkeepingSettings,
    BookkeepingAccount,
    FiscalYear,
    JournalEntry,
    JournalEntryLine,
    PostingRuleSet,
    Expense,
    ExpenseReceipt,
    FiscalYearStatement
];

/**
 * The company of the books of the corporations of the cases, with its register.
 */
export const testCompany: BookkeepingCompany = {
    name: 'Example GmbH',
    seat: 'Berlin',
    registerCourt: 'Amtsgericht Charlottenburg',
    registerNumber: 'HRB 123456 B'
};

/**
 * A conformance that refuses to close every fiscal year it applies to: those of a tenant of the legal form
 * `Refusing GmbH`, and those naming it.
 */
export class RefusingConformanceService implements BookkeepingConformanceServiceInterface {

    readonly name: string = 'test-refusing';

    isApplicable(legalForm: string): boolean {
        return legalForm === 'Refusing GmbH';
    }

    resolveClosingProposals(): NewJournalEntry[] {
        return [];
    }

    validateClosing(closing: BookkeepingClosing): void {
        throw new ConflictError($ts`The fiscal year ${closing.fiscalYear.id} needs to be closed by hand.`);
    }
}

/**
 * A conformance of a reserve, like the one of a UG: a quarter of the profit of a year goes from the account `2970` to
 * the reserve `2930`, proposed at closing and validated before the year is closed.
 */
export class ReserveConformanceService implements BookkeepingConformanceServiceInterface {

    readonly name: string = 'test-reserve';

    isApplicable(legalForm: string): boolean {
        return legalForm === 'UG';
    }

    async resolveClosingProposals(closing: BookkeepingClosing): Promise<NewJournalEntry[]> {
        const reserve: BigNumber = this.resolveReserve(closing);
        if (!reserve.isGreaterThan(0) || this.resolveReserved(closing).isGreaterThanOrEqualTo(reserve)) {
            return [];
        }
        const accounts: Repository<BookkeepingAccount> = inject(repositoryTokenFor(BookkeepingAccount));
        const [from, to] = await Promise.all([
            accounts.findOne({ where: { number: '2970' } }),
            accounts.findOne({ where: { number: '2930' } })
        ]);
        return [
            {
                documentDate: closing.fiscalYear.end,
                postingDate: closing.fiscalYear.end,
                documentReference: null,
                text: 'Reserve',
                lines: [{ accountId: from.id, debit: reserve, credit: null }, { accountId: to.id, debit: null, credit: reserve }]
            }
        ];
    }

    validateClosing(closing: BookkeepingClosing): void {
        if (this.resolveReserved(closing).isLessThan(this.resolveReserve(closing))) {
            throw new ConflictError($ts`The reserve needs to be posted before the fiscal year is closed.`);
        }
    }

    private resolveReserve(closing: BookkeepingClosing): BigNumber {
        const profit: BigNumber = closing.balances
            .filter(b => b.account.type === BookkeepingAccountType.REVENUE || b.account.type === BookkeepingAccountType.EXPENSE)
            .reduce((sum, b) => sum.plus(b.credit).minus(b.debit), new BigNumber(0));
        return NumberUtilities.round(NumberUtilities.multiply(profit, 0.25), 2);
    }

    private resolveReserved(closing: BookkeepingClosing): BigNumber {
        const reserve: { credit: BigNumber } | undefined = closing.balances.find(b => b.account.number === '2930');
        return reserve?.credit ?? new BigNumber(0);
    }
}

/**
 * The conformances the books of the cases are kept with.
 */
export const bookkeepingTestConformances: DiProvider<BookkeepingConformanceServiceInterface[]> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES,
    useValue: [new RefusingConformanceService(), new ReserveConformanceService()]
});

/**
 * The options the books of the cases are kept with: a tenant without settings posts nothing.
 */
export const bookkeepingTestOptions: DiProvider<BookkeepingPluginOptionsInput> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: { tenantsWithoutBooks: 'post-nothing' }
});

/**
 * The accounts of the books of the cases, by what they are called in them.
 */
type AccountName = 'bank' | 'receivables' | 'vat' | 'capital' | 'reserve' | 'result' | 'revenue' | 'rent';

/**
 * The books of a tenant of its own.
 */
export type TestBooks = {

    tenantId: string,

    settings: BookkeepingSettings,

    accounts: Record<AccountName, BookkeepingAccount>,
    /**
     * The fiscal year 2026.
     */
    fiscalYear: FiscalYear
};

/**
 * A line of an entry of the cases: the account, the side and the amount.
 */
type TestLine = [AccountName, 'debit' | 'credit', string];

const ACCOUNTS: Record<AccountName, Pick<BookkeepingAccountCreateData, 'number' | 'name' | 'type'>> = {
    bank: { number: '1200', name: 'Bank', type: BookkeepingAccountType.ASSET },
    receivables: { number: '1400', name: 'Receivables', type: BookkeepingAccountType.ASSET },
    vat: { number: '3806', name: 'VAT 19 %', type: BookkeepingAccountType.LIABILITY },
    capital: { number: '2900', name: 'Share capital', type: BookkeepingAccountType.EQUITY },
    reserve: { number: '2930', name: 'Reserve', type: BookkeepingAccountType.EQUITY },
    result: { number: '2970', name: 'Profit carried forward', type: BookkeepingAccountType.EQUITY },
    revenue: { number: '8400', name: 'Revenue 19 %', type: BookkeepingAccountType.REVENUE },
    rent: { number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE }
};

/**
 * A day, as the books hold it.
 * @param value - The day, such as `2026-03-31`.
 * @returns Its midnight UTC.
 */
export function day(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Runs work as a tenant.
 * @param tenantId - The tenant.
 * @param work - The work.
 * @returns What the work returns.
 */
export async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * The journal service.
 * @returns The service.
 */
export function journal(): JournalServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE);
}

/**
 * Starts the books of a new tenant with their settings, in EUR.
 * @param legalForm - The legal form of the tenant, from 2020-01-01. `GmbH` by default.
 * @returns The tenant and the settings.
 */
export async function createSettings(legalForm: string = 'GmbH'): Promise<[string, BookkeepingSettings]> {
    const tenantId: string = UUIDUtilities.generate();
    const settings: BookkeepingSettings = await inTenant(tenantId, async () => await journal().createSettings({
        currency: 'EUR',
        legalForms: [{ legalForm, validFrom: day('2020-01-01') }]
    }));
    return [tenantId, settings];
}

/**
 * Starts the books of a new tenant: its settings, its accounts and its fiscal year 2026.
 * @param legalForm - The legal form of the tenant, `GmbH` by default.
 * @returns The books.
 */
export async function createBooks(legalForm: string = 'GmbH'): Promise<TestBooks> {
    const [tenantId, settings] = await createSettings(legalForm);
    return await inTenant(tenantId, async () => {
        const repository: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
        const create: (name: AccountName) => Promise<BookkeepingAccount> = async name => await repository.create(
            { ...ACCOUNTS[name], statementPosition: null }
        );
        const [bank, receivables, vat, capital, reserve, result, revenue, rent] = await Promise.all([
            create('bank'),
            create('receivables'),
            create('vat'),
            create('capital'),
            create('reserve'),
            create('result'),
            create('revenue'),
            create('rent')
        ]);
        const fiscalYear: FiscalYear = await journal().createFiscalYear({ start: day('2026-01-01') });
        return { tenantId, settings, accounts: { bank, receivables, vat, capital, reserve, result, revenue, rent }, fiscalYear };
    });
}

/**
 * An entry of the books.
 * @param books - The books.
 * @param postingDate - The posting date, such as `2026-03-31`.
 * @param lines - The lines.
 * @returns The entry, as `post` takes it.
 */
export function entryOf(books: TestBooks, postingDate: string, lines: TestLine[]): JournalEntryPosting {
    return {
        documentDate: day(postingDate),
        postingDate: day(postingDate),
        documentReference: 'RE-1',
        text: 'Booked',
        lines: lines.map(([account, side, amount]): NewJournalEntryLine => ({
            accountId: books.accounts[account].id,
            debit: side === 'debit' ? new BigNumber(amount) : null,
            credit: side === 'credit' ? new BigNumber(amount) : null
        }))
    };
}

/**
 * Posts an entry into the books.
 * @param books - The books.
 * @param postingDate - The posting date.
 * @param lines - The lines.
 * @param transaction - The transaction, one of its own by default.
 * @returns The entry.
 */
export async function post(
    books: TestBooks,
    postingDate: string,
    lines: TestLine[],
    transaction?: Transaction
): Promise<JournalEntryDetails> {
    return await inTenant(books.tenantId, async () => await journal().post(entryOf(books, postingDate, lines), transaction));
}

/**
 * The lines of an entry, as the cases write them.
 * @param books - The books, with their accounts by what they are called in the cases.
 * @param books.accounts - The accounts.
 * @param lines - The lines.
 * @returns Each line as the name of its account, or its id for an account of other books, its side and its amount.
 */
export function describeLines(
    books: { accounts: Record<string, BookkeepingAccount> },
    lines: NewJournalEntryLine[]
): [string, 'debit' | 'credit', string][] {
    const names: Map<string, string> = new Map(Object.entries(books.accounts).map(([name, a]) => [a.id, name]));
    return lines.map((line): [string, 'debit' | 'credit', string] => [
        names.get(line.accountId) ?? line.accountId,
        line.debit == undefined ? 'credit' : 'debit',
        (line.debit ?? line.credit ?? new BigNumber(0)).toFixed(2)
    ]);
}

/**
 * The store of a repository, beneath the observers of its writes, the way someone with access to the data source
 * writes to it.
 * @param repository - The repository.
 * @returns The driver.
 */
export function storeOf<T extends BaseEntity>(repository: Repository<T>): RepositoryDriverInterface<T, RepositoryTransaction> {
    let driver: RepositoryDriverInterface<T, RepositoryTransaction> = repository['driver'];
    while (driver instanceof DeadlineAwareRepositoryDriver || driver instanceof WriteObservingRepositoryDriver) {
        const forwarding: ForwardingRepositoryDriver<T, RepositoryTransaction> = driver;
        driver = forwarding['inner'];
    }
    return driver;
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeBookkeeping(dataSourceName: string): void {
    function entries(): Repository<JournalEntry> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    function lines(): Repository<JournalEntryLine> {
        return inject(repositoryTokenFor(JournalEntryLine));
    }

    function fiscalYears(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    describe(`the books on ${dataSourceName}`, () => {
        describe('the settings of the books', () => {
            it('are created once per tenant', async () => {
                const [tenantId, settings] = await createSettings();

                expect(settings).toMatchObject({
                    tenantId,
                    currency: 'EUR',
                    legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }]
                });
                const again: Promise<BookkeepingSettings> = inTenant(
                    tenantId,
                    async () => await journal().createSettings({ currency: 'USD', legalForms: [] })
                );
                await expect(again).rejects.toThrow(ConflictError);
                await expect(again)
                    .rejects.toThrow('The books of the tenant have settings already, which are changed rather than created again.');
            });

            it('change their currency until there is a fiscal year, and refuse it afterwards', async () => {
                const [tenantId] = await createSettings();

                const changed: BookkeepingSettings = await inTenant(
                    tenantId,
                    async () => await journal().updateSettings({ currency: 'USD' })
                );
                await inTenant(tenantId, async () => await journal().createFiscalYear({ start: day('2026-01-01') }));

                expect(changed.currency).toBe('USD');
                await expect(inTenant(tenantId, async () => await journal().updateSettings({ currency: 'EUR' })))
                    .rejects.toThrow('The currency of the books needs to stay USD, as a fiscal year is kept in it.');
                expect((await inTenant(tenantId, async () => await journal().updateSettings({ currency: 'USD' }))).currency).toBe('USD');
            });

            it('append a legal form valid after the end of the last closed fiscal year, and refuse one on or before it', async () => {
                const books: TestBooks = await createBooks('UG');
                await inTenant(books.tenantId, async () => await journal().closeFiscalYear(
                    books.fiscalYear.id,
                    { resultAccountId: books.accounts.result.id }
                ));

                await expect(inTenant(books.tenantId, async () => await journal().updateSettings({
                    legalForm: { legalForm: 'GmbH', validFrom: day('2026-12-31') }
                }))).rejects.toThrow(
                    'The legal form valid from 2026-12-31 needs to be valid from after 2026-12-31, the end of the last closed fiscal year.'
                );
                await expect(inTenant(books.tenantId, async () => await journal().updateSettings({
                    legalForm: { legalForm: 'GmbH', validFrom: day('2019-01-01') }
                }))).rejects.toThrow(
                    'The legal form valid from 2019-01-01 needs to be valid from after 2020-01-01, '
                    + 'the day the latest legal form is valid from.'
                );
                const appended: BookkeepingSettings = await inTenant(books.tenantId, async () => await journal().updateSettings({
                    legalForm: { legalForm: 'GmbH', validFrom: day('2027-06-01') }
                }));

                expect(appended.legalForms).toEqual([
                    { legalForm: 'UG', validFrom: day('2020-01-01') },
                    { legalForm: 'GmbH', validFrom: day('2027-06-01') }
                ]);
            });

            it('replace their company with the one a change gives, keeping nothing of the one before', async () => {
                const tenantId: string = UUIDUtilities.generate();
                // of no legal form, whose company needs nothing but its name
                await inTenant(
                    tenantId,
                    async () => await journal().createSettings({ currency: 'EUR', legalForms: [], company: testCompany })
                );

                const changed: BookkeepingSettings = await inTenant(
                    tenantId,
                    async () => await journal().updateSettings({ company: { name: 'Example Holding' } })
                );
                const read: BookkeepingSettings | undefined = await inTenant(tenantId, async () => await journal().findSettings());

                for (const company of [changed.company, read?.company]) {
                    expect([company?.name, company?.seat ?? null, company?.registerCourt ?? null, company?.registerNumber ?? null])
                        .toStrictEqual(['Example Holding', null, null, null]);
                }
            });

            it('are needed before anything is posted', async () => {
                const tenantId: string = UUIDUtilities.generate();

                await expect(inTenant(tenantId, async () => await journal().post({
                    documentDate: day('2026-03-01'),
                    postingDate: day('2026-03-01'),
                    text: 'Booked',
                    lines: []
                }))).rejects.toThrow('The books of the tenant need settings, with the currency they are kept in, before they are kept.');
                expect(await inTenant(tenantId, async () => await journal().findSettings())).toBeUndefined();
            });
        });

        describe('posting an entry', () => {
            it('numbers the entries of a fiscal year from 1, and keeps the lines in their own chain', async () => {
                const books: TestBooks = await createBooks();

                const first: JournalEntryDetails = await post(
                    books,
                    '2026-01-02',
                    [['bank', 'debit', '25000'], ['capital', 'credit', '25000']]
                );
                const second: JournalEntryDetails = await post(books, '2026-03-01', [
                    ['receivables', 'debit', '1190.00'],
                    ['revenue', 'credit', '1000.00'],
                    ['vat', 'credit', '190.00']
                ]);

                expect([first.entry.sequence, second.entry.sequence]).toEqual([1, 2]);
                expect(second.entry).toMatchObject({
                    tenantId: books.tenantId,
                    fiscalYearId: books.fiscalYear.id,
                    text: 'Booked',
                    chainSequence: 2
                });
                expect(describeLines(books, second.lines)).toEqual([
                    ['receivables', 'debit', '1190.00'],
                    ['revenue', 'credit', '1000.00'],
                    ['vat', 'credit', '190.00']
                ]);
                expect(second.lines.map(l => l.chainSequence)).toEqual([3, 4, 5]);
                const stored: JournalEntryDetails = await inTenant(books.tenantId, async () => await journal().findEntry(second.entry.id));
                expect(describeLines(books, stored.lines)).toEqual(describeLines(books, second.lines));
            });

            it('keeps an entry and its lines for 10 years from the end of the calendar year its fiscal year ends in', async () => {
                const books: TestBooks = await createBooks();

                const posted: JournalEntryDetails = await post(books, '2026-05-04', [['rent', 'debit', '500'], ['bank', 'credit', '500']]);

                const retainUntil: ZonedDate = getZonedDate(
                    posted.entry.retainUntil,
                    inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
                );
                expect(retainUntil).toMatchObject({ year: 2037, month: 0, day: 1, hours: 0, minutes: 0 });
                expect(posted.lines.map(l => l.retainUntil.getTime()))
                    .toEqual([posted.entry.retainUntil.getTime(), posted.entry.retainUntil.getTime()]);
            });

            it('refuses an entry whose debits do not add up to its credits', async () => {
                const books: TestBooks = await createBooks();

                const posting: Promise<JournalEntryDetails> = post(
                    books,
                    '2026-03-01',
                    [['bank', 'debit', '100'], ['revenue', 'credit', '90']]
                );

                await expect(posting).rejects.toThrow(BadRequestError);
                await expect(posting).rejects.toThrow('The debits of the entry, 100.00, need to add up to its credits, 90.00.');
            });

            it('refuses an entry of fewer than 2 lines, a line on both sides or none, and an amount not above 0', async () => {
                const books: TestBooks = await createBooks();

                await expect(post(books, '2026-03-01', [['bank', 'debit', '100']]))
                    .rejects.toThrow('A journal entry needs to have at least 2 lines.');
                await expect(inTenant(books.tenantId, async () => await journal().post({
                    ...entryOf(books, '2026-03-01', [['bank', 'debit', '100'], ['revenue', 'credit', '100']]),
                    lines: [
                        { accountId: books.accounts.bank.id, debit: new BigNumber(100), credit: new BigNumber(100) },
                        { accountId: books.accounts.revenue.id, debit: null, credit: null }
                    ]
                }))).rejects.toThrow('Line 1 needs to have either a debit or a credit.');
                await expect(post(books, '2026-03-01', [['bank', 'debit', '0'], ['revenue', 'credit', '0']]))
                    .rejects.toThrow('The amount of line 1 needs to be above 0.');
                await expect(post(books, '2026-03-01', [['bank', 'debit', '-5'], ['revenue', 'debit', '5']]))
                    .rejects.toThrow('The amount of line 1 needs to be above 0.');
            });

            it('refuses an amount with more decimals than the currency of the books has', async () => {
                const books: TestBooks = await createBooks();

                await expect(post(books, '2026-03-01', [['bank', 'debit', '10.005'], ['revenue', 'credit', '10.005']]))
                    .rejects.toThrow('The amount of line 1 needs to have at most 2 decimals, the minor units of EUR.');
            });

            it('refuses a posting date with a time, or outside every fiscal year', async () => {
                const books: TestBooks = await createBooks();

                await expect(inTenant(books.tenantId, async () => await journal().post({
                    ...entryOf(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]),
                    postingDate: new Date('2026-03-01T10:00:00.000Z')
                }))).rejects.toThrow('The postingDate needs to be a day without a time, such as 2026-03-31.');
                const outside: Promise<JournalEntryDetails> = post(
                    books,
                    '2027-01-01',
                    [['bank', 'debit', '1'], ['revenue', 'credit', '1']]
                );
                await expect(outside).rejects.toThrow(ConflictError);
                await expect(outside).rejects.toThrow('The posting date 2027-01-01 needs to fall into a fiscal year, and none covers it.');
            });

            it('stores no role a line handed in from code holds beyond its type, '
                + 'as only the closing of a fiscal year sets one', async () => {
                const books: TestBooks = await createBooks();
                const entry: JournalEntryPosting = entryOf(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);

                // the compiler refuses a role on a line written out, not on one mapped from a wider object
                const posted: JournalEntryDetails = await inTenant(books.tenantId, async () => await journal().post({
                    ...entry,
                    lines: entry.lines.map((line, index) => index === 1 ? { ...line, role: JournalEntryLineRole.RESULT } : line)
                }));
                expect(posted.lines.map(l => l.role ?? null)).toEqual([null, null]);
                const stored: JournalEntryLine[] = await inTenant(
                    books.tenantId,
                    async () => await lines().findAll({ where: { entryId: posted.entry.id } })
                );
                expect(stored.map(l => l.role ?? null)).toEqual([null, null]);
            });

            it('refuses an account that does not exist, that another tenant has, or that is closed', async () => {
                const books: TestBooks = await createBooks();
                const other: TestBooks = await createBooks();
                await inTenant(
                    books.tenantId,
                    async () => await inject<Repository<BookkeepingAccount>>(repositoryTokenFor(BookkeepingAccount))
                        .updateById(books.accounts.rent.id, { closedAt: new Date() })
                );
                const unknown: string = UUIDUtilities.generate();

                await expect(inTenant(books.tenantId, async () => await journal().post({
                    ...entryOf(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]),
                    lines: [
                        { accountId: books.accounts.bank.id, debit: new BigNumber(1) },
                        { accountId: unknown, credit: new BigNumber(1) }
                    ]
                }))).rejects.toThrow(`Line 2 needs to name an account of the books, and "${unknown}" is none.`);
                await expect(inTenant(books.tenantId, async () => await journal().post({
                    ...entryOf(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]),
                    lines: [
                        { accountId: books.accounts.bank.id, debit: new BigNumber(1) },
                        { accountId: other.accounts.revenue.id, credit: new BigNumber(1) }
                    ]
                }))).rejects.toThrow(`Line 2 needs to name an account of the books, and "${other.accounts.revenue.id}" is none.`);
                await expect(post(books, '2026-03-01', [['bank', 'credit', '1'], ['rent', 'debit', '1']]))
                    .rejects.toThrow('Line 2 needs to name an open account, and the account 4210 Rent is closed.');
            });

            it('draws the sequence in the transaction, so an entry rolled back leaves no gap', async () => {
                const books: TestBooks = await createBooks();
                await post(books, '2026-01-02', [['bank', 'debit', '1'], ['capital', 'credit', '1']]);

                const transaction: Transaction = await entries().dataSource.startTransaction();
                const abandoned: JournalEntryDetails = await post(
                    books,
                    '2026-01-03',
                    [['bank', 'debit', '2'], ['capital', 'credit', '2']],
                    transaction
                );
                await transaction.rollback();
                const next: JournalEntryDetails = await post(books, '2026-01-04', [['bank', 'debit', '3'], ['capital', 'credit', '3']]);

                expect([abandoned.entry.sequence, next.entry.sequence]).toEqual([2, 2]);
                const stored: JournalEntry[] = await inTenant(
                    books.tenantId,
                    async () => await entries().findAll({ order: { sequence: 'ASC' }, limit: 'all' })
                );
                expect(stored.map(e => e.sequence)).toEqual([1, 2]);
            });

            it('refuses a second entry of the same source', async () => {
                const books: TestBooks = await createBooks();
                const source: string = UUIDUtilities.generate();
                const ofSource: JournalEntryPosting = {
                    ...entryOf(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]),
                    sourceType: 'test.source',
                    sourceId: source
                };
                await inTenant(books.tenantId, async () => await journal().post(ofSource));

                const again: Promise<JournalEntryDetails> = inTenant(books.tenantId, async () => await journal().post(ofSource));

                await expect(again).rejects.toThrow(ConflictError);
                await expect(again).rejects.toThrow(`The source test.source "${source}" is posted already, and a source is posted once.`);
            });
        });

        describe('posting entries at the same moment', () => {
            it('gives each entry its own sequence, without a gap', async () => {
                const books: TestBooks = await createBooks();

                const posted: JournalEntryDetails[] = await Promise.all([1, 2, 3, 4, 5, 6].map(async amount => await post(
                    books,
                    '2026-02-01',
                    [['bank', 'debit', String(amount)], ['capital', 'credit', String(amount)]]
                )));

                expect(posted.map(p => p.entry.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
                expect((await inTenant(books.tenantId, async () => await fiscalYears().findById(books.fiscalYear.id))).lastSequence)
                    .toBe(6);
            });

            it('gives each entry its own sequence when each runs in a transaction of its own, '
                + 'and one rolled back leaves no gap', async () => {
                const books: TestBooks = await createBooks();

                /**
                 * Posts an entry inside a transaction of its own, ended as soon as the entry comes back.
                 * @param amount - The amount of the entry.
                 * @param commit - Whether the transaction is committed, or rolled back.
                 */
                async function postInTransaction(amount: number, commit: boolean): Promise<void> {
                    const transaction: Transaction = await entries().dataSource.startTransaction();
                    await post(
                        books,
                        '2026-02-01',
                        [['bank', 'debit', String(amount)], ['capital', 'credit', String(amount)]],
                        transaction
                    );
                    await (commit ? transaction.commit() : transaction.rollback());
                }
                await Promise.all([
                    postInTransaction(1, true),
                    postInTransaction(2, false),
                    postInTransaction(3, true),
                    postInTransaction(4, true)
                ]);

                const stored: JournalEntry[] = await inTenant(
                    books.tenantId,
                    async () => await entries().findAll({ order: { sequence: 'ASC' }, limit: 'all' })
                );
                expect(stored.map(e => e.sequence)).toEqual([1, 2, 3]);
                expect(stored.map(e => e.chainSequence).sort((a, b) => a - b)).toEqual([1, 2, 3]);
            });

            it('links the entries posted at once into the chain of the tenant', async () => {
                const books: TestBooks = await createBooks();

                await Promise.all([1, 2, 3, 4].map(async amount => await post(
                    books,
                    '2026-02-01',
                    [['bank', 'debit', String(amount)], ['capital', 'credit', String(amount)]]
                )));

                const stored: JournalEntry[] = await inTenant(
                    books.tenantId,
                    async () => await entries().findAll({ order: { chainSequence: 'ASC' }, limit: 'all' })
                );
                expect(stored.map(e => e.chainSequence)).toEqual([1, 2, 3, 4]);
                expect(await inTenant(books.tenantId, async () => (await journal().resolveVerification()).intact)).toBe(true);
            });

            it('closes a fiscal year once a posting into it under way is done, and refuses the ones after', async () => {
                const books: TestBooks = await createBooks();
                await post(books, '2026-01-02', [['bank', 'debit', '100'], ['capital', 'credit', '100']]);

                const transaction: Transaction = await entries().dataSource.startTransaction();
                await post(books, '2026-06-01', [['rent', 'debit', '10'], ['bank', 'credit', '10']], transaction);
                const closing: Promise<FiscalYearClosingResult> = inTenant(books.tenantId, async () => await journal().closeFiscalYear(
                    books.fiscalYear.id,
                    { resultAccountId: books.accounts.result.id }
                ));
                await transaction.commit();
                const closed: FiscalYearClosingResult = await closing;

                await expect(post(books, '2026-06-02', [['rent', 'debit', '10'], ['bank', 'credit', '10']])).rejects.toThrow('is closed');
                // the bank opens with the 100 paid in less the 10 of the posting the closing waited for
                expect(describeLines(books, closed.openingEntry?.lines ?? [])).toEqual([
                    ['bank', 'debit', '90.00'],
                    ['capital', 'credit', '100.00'],
                    ['result', 'debit', '10.00']
                ]);
            });
        });

        describe('the stored rows', () => {
            it('are never updated or deleted through the repository', async () => {
                const books: TestBooks = await createBooks();
                const posted: JournalEntryDetails = await post(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);

                await inTenant(books.tenantId, async () => {
                    await expect(entries().updateById(posted.entry.id, { text: 'Changed' })).rejects.toThrow();
                    await expect(entries().deleteById(posted.entry.id)).rejects.toThrow();
                    await expect(lines().updateById(String(posted.lines[0]?.id), { debit: new BigNumber(2) })).rejects.toThrow();
                    await expect(lines().deleteById(String(posted.lines[0]?.id))).rejects.toThrow();
                    expect((await entries().findById(posted.entry.id)).text).toBe('Booked');
                    expect((await lines().findById(String(posted.lines[0]?.id))).debit?.toFixed()).toBe('1');
                });
            });

            it('are checked: an entry changed past the repository is named', async () => {
                const books: TestBooks = await createBooks();
                await post(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);
                const second: JournalEntryDetails = await post(books, '2026-03-02', [['bank', 'debit', '2'], ['revenue', 'credit', '2']]);
                await post(books, '2026-03-03', [['bank', 'debit', '3'], ['revenue', 'credit', '3']]);
                const intact: BookkeepingVerification = await inTenant(books.tenantId, async () => await journal().resolveVerification());

                await storeOf(entries()).updateAll({ where: { id: second.entry.id }, data: { text: 'Rewritten' } });

                expect(intact).toMatchObject({ intact: true, newestEntrySequence: 3, newestLineSequence: 6, problems: [] });
                const verification: BookkeepingVerification = await inTenant(
                    books.tenantId,
                    async () => await journal().resolveVerification()
                );
                expect(verification).toMatchObject({
                    intact: false,
                    newestEntrySequence: null,
                    newestLineSequence: 6,
                    problems: [{ entryId: second.entry.id, lineId: null, reason: 'The row is not as it was written.' }]
                });
            });

            it('are checked: a line changed past the repository is named, and its entry no longer balances', async () => {
                const books: TestBooks = await createBooks();
                const posted: JournalEntryDetails = await post(
                    books,
                    '2026-03-01',
                    [['bank', 'debit', '100'], ['revenue', 'credit', '100']]
                );
                const line: JournalEntryLine | undefined = posted.lines[0];

                await storeOf(lines()).updateAll({ where: { id: line?.id }, data: { debit: new BigNumber(1000) } });

                const verification: BookkeepingVerification = await inTenant(
                    books.tenantId,
                    async () => await journal().resolveVerification()
                );
                expect(verification.intact).toBe(false);
                expect(verification.problems).toEqual([
                    { entryId: posted.entry.id, lineId: line?.id, reason: 'The row is not as it was written.' },
                    { entryId: posted.entry.id, lineId: null, reason: 'The debits of the entry, 1000, do not add up to its credits, 100.' }
                ]);
            });
        });

        describe('reversing an entry', () => {
            it('posts the mirror of the entry, referencing it', async () => {
                const books: TestBooks = await createBooks();
                const original: JournalEntryDetails = await post(books, '2026-03-01', [
                    ['receivables', 'debit', '1190'],
                    ['revenue', 'credit', '1000'],
                    ['vat', 'credit', '190']
                ]);

                const reversal: JournalEntryDetails = await inTenant(books.tenantId, async () => await journal().reverse(
                    original.entry.id,
                    { postingDate: day('2026-03-05'), text: 'Wrong customer', createdBy: 'ada' }
                ));

                expect(reversal.entry).toMatchObject({
                    reversesEntryId: original.entry.id,
                    sequence: 2,
                    postingDate: day('2026-03-05'),
                    documentReference: 'RE-1',
                    text: 'Wrong customer',
                    createdBy: 'ada'
                });
                expect(describeLines(books, reversal.lines)).toEqual([
                    ['receivables', 'credit', '1190.00'],
                    ['revenue', 'debit', '1000.00'],
                    ['vat', 'debit', '190.00']
                ]);
            });

            it('refuses to reverse an entry twice, and to reverse a reversal', async () => {
                const books: TestBooks = await createBooks();
                const original: JournalEntryDetails = await post(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);
                const reversal: JournalEntryDetails = await inTenant(books.tenantId, async () => await journal().reverse(
                    original.entry.id,
                    { postingDate: day('2026-03-05'), text: 'Wrong' }
                ));

                const again: Promise<JournalEntryDetails> = inTenant(books.tenantId, async () => await journal().reverse(
                    original.entry.id,
                    { postingDate: day('2026-03-06'), text: 'Again' }
                ));
                await expect(again).rejects.toThrow(ConflictError);
                await expect(again)
                    .rejects.toThrow(`The entry "${original.entry.id}" is reversed already, and an entry is reversed at most once.`);
                await expect(inTenant(books.tenantId, async () => await journal().reverse(
                    reversal.entry.id,
                    { postingDate: day('2026-03-06'), text: 'Back' }
                ))).rejects.toThrow(`The entry "${reversal.entry.id}" is a reversal, which is not reversed.`);
            });
        });

        describe('adding a fiscal year', () => {
            it('ends the first at the end of the calendar year, and starts the next the day after', async () => {
                const [tenantId] = await createSettings();
                const books: TestBooks = await createBooks();

                const first: FiscalYear = await inTenant(
                    tenantId,
                    async () => await journal().createFiscalYear({ start: day('2025-03-15') })
                );
                const second: FiscalYear = await inTenant(tenantId, async () => await journal().createFiscalYear({}));

                expect([first.start, first.end, second.start, second.end])
                    .toEqual([day('2025-03-15'), day('2025-12-31'), day('2026-01-01'), day('2026-12-31')]);
                expect(books.fiscalYear).toMatchObject({ start: day('2026-01-01'), end: day('2026-12-31'), lastSequence: 0 });
            });

            it('keeps the rhythm of a fiscal year that is not the calendar year', async () => {
                const [tenantId] = await createSettings();

                await inTenant(
                    tenantId,
                    async () => await journal().createFiscalYear({ start: day('2025-07-01'), end: day('2026-06-30') })
                );
                const next: FiscalYear = await inTenant(tenantId, async () => await journal().createFiscalYear({}));

                expect([next.start, next.end]).toEqual([day('2026-07-01'), day('2027-06-30')]);
            });

            it('refuses a fiscal year that overlaps the one before, leaves a gap, or names no start for the first', async () => {
                const books: TestBooks = await createBooks();

                const overlapping: Promise<FiscalYear> = inTenant(
                    books.tenantId,
                    async () => await journal().createFiscalYear({ start: day('2026-12-01') })
                );
                await expect(overlapping).rejects.toThrow(ConflictError);
                await expect(overlapping).rejects.toThrow(
                    'The fiscal year needs to start on 2027-01-01, the day after the fiscal year from 2026-01-01 to 2026-12-31 ends.'
                );
                await expect(inTenant(books.tenantId, async () => await journal().createFiscalYear({ start: day('2027-02-01') })))
                    .rejects.toThrow('The fiscal year needs to start on 2027-01-01');
                await expect(inTenant(
                    books.tenantId,
                    async () => await journal().createFiscalYear({ start: day('2025-01-01'), end: day('2025-12-31') })
                )).rejects.toThrow('The fiscal year needs to start on 2027-01-01');
                await expect(inTenant(books.tenantId, async () => await journal().createFiscalYear({ end: day('2026-12-31') })))
                    .rejects.toThrow('The end needs to be on or after the start, 2027-01-01.');
                await expect(inTenant(books.tenantId, async () => await journal().createFiscalYear({ conformances: ['unknown'] })))
                    .rejects.toThrow(
                        'The conformance "unknown" needs to be registered in '
                        + 'ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES.'
                    );
                const [newTenantId] = await createSettings();
                await expect(inTenant(newTenantId, async () => await journal().createFiscalYear({})))
                    .rejects.toThrow('The first fiscal year needs to name its start.');
            });
        });

        describe('closing a fiscal year', () => {
            /**
             * Posts the year of the cases: the capital paid in, an invoice and its payment, and the rent.
             * @param books - The books.
             */
            async function postYear(books: TestBooks): Promise<void> {
                await post(books, '2026-01-02', [['bank', 'debit', '25000'], ['capital', 'credit', '25000']]);
                await post(
                    books,
                    '2026-03-01',
                    [['receivables', 'debit', '1190'], ['revenue', 'credit', '1000'], ['vat', 'credit', '190']]
                );
                await post(books, '2026-03-20', [['bank', 'debit', '1190'], ['receivables', 'credit', '1190']]);
                await post(books, '2026-04-01', [['rent', 'debit', '500'], ['bank', 'credit', '500']]);
            }

            async function close(books: TestBooks, fiscalYearId: string = books.fiscalYear.id): Promise<FiscalYearClosingResult> {
                return inTenant(books.tenantId, async () => await journal().closeFiscalYear(
                    fiscalYearId,
                    { resultAccountId: books.accounts.result.id }
                ));
            }

            it('carries the result into equity, and opens the next year with the balances it closes with', async () => {
                const books: TestBooks = await createBooks();
                await postYear(books);

                const closed: FiscalYearClosingResult = await close(books);

                expect(closed.fiscalYear.closedAt).toBeInstanceOf(Date);
                expect(closed.fiscalYear.lastSequence).toBe(5);
                expect(closed.nextFiscalYear).toMatchObject({ start: day('2027-01-01'), end: day('2027-12-31'), lastSequence: 1 });
                expect(closed.closingEntry?.entry).toMatchObject({
                    sequence: 5,
                    postingDate: day('2026-12-31'),
                    sourceType: 'bookkeeping.closing',
                    sourceId: books.fiscalYear.id
                });
                expect(describeLines(books, closed.closingEntry?.lines ?? [])).toEqual([
                    ['rent', 'credit', '500.00'],
                    ['revenue', 'debit', '1000.00'],
                    ['result', 'credit', '500.00']
                ]);
                // the line carrying the result is marked as such, as stored
                expect(closed.closingEntry?.lines.map(l => l.role ?? null)).toEqual([null, null, JournalEntryLineRole.RESULT]);
                const storedClosing: JournalEntryDetails = await inTenant(
                    books.tenantId,
                    async () => await journal().findEntry(closed.closingEntry?.entry.id ?? '')
                );
                expect(storedClosing.lines.map(l => l.role ?? null)).toEqual([null, null, JournalEntryLineRole.RESULT]);
                expect(closed.openingEntry?.entry).toMatchObject({
                    fiscalYearId: closed.nextFiscalYear.id,
                    sequence: 1,
                    postingDate: day('2027-01-01'),
                    sourceType: 'bookkeeping.opening',
                    sourceId: books.fiscalYear.id
                });
                expect(describeLines(books, closed.openingEntry?.lines ?? [])).toEqual([
                    ['bank', 'debit', '25690.00'],
                    ['capital', 'credit', '25000.00'],
                    ['result', 'credit', '500.00'],
                    ['vat', 'credit', '190.00']
                ]);

                // the balances of the balance sheet accounts as the lines of the closed year add up, the closing entry
                // included, against the lines opening the next one
                const closingBalances: Map<string, string> = new Map();
                const yearLines: JournalEntryLine[] = await inTenant(books.tenantId, async () => await lines().findAll({
                    where: { fiscalYearId: books.fiscalYear.id },
                    limit: 'all'
                }));
                const balanceSheet: Set<string> = new Set([
                    books.accounts.bank,
                    books.accounts.receivables,
                    books.accounts.vat,
                    books.accounts.capital,
                    books.accounts.result
                ].map(a => a.id));
                for (const line of yearLines.filter(l => balanceSheet.has(l.accountId))) {
                    const before: BigNumber = new BigNumber(closingBalances.get(line.accountId) ?? 0);
                    closingBalances.set(line.accountId, before.plus(line.debit ?? 0).minus(line.credit ?? 0)
                        .toFixed(2));
                }
                const opening: Map<string, string> = new Map((closed.openingEntry?.lines ?? []).map(l => [
                    l.accountId,
                    new BigNumber(0).plus(l.debit ?? 0)
                        .minus(l.credit ?? 0)
                        .toFixed(2)
                ]));
                expect(opening).toEqual(new Map([...closingBalances].filter(([, balance]) => balance !== '0.00')));
            });

            it('chains the role of the result line: a role changed past the repository is named', async () => {
                const books: TestBooks = await createBooks();
                await postYear(books);
                const closed: FiscalYearClosingResult = await close(books);
                const resultLine: JournalEntryLine | undefined = closed.closingEntry?.lines
                    .find(l => l.role === JournalEntryLineRole.RESULT);

                await storeOf(lines()).updateAll({ where: { id: resultLine?.id }, data: { role: null } });

                const verification: BookkeepingVerification = await inTenant(
                    books.tenantId,
                    async () => await journal().resolveVerification()
                );
                expect(verification.intact).toBe(false);
                const reason: string = 'The row is not as it was written.';
                expect(verification.problems).toEqual([{ entryId: closed.closingEntry?.entry.id, lineId: resultLine?.id, reason }]);
            });

            it('refuses every posting into the closed year, and closing it again', async () => {
                const books: TestBooks = await createBooks();
                await postYear(books);
                await close(books);

                const posting: Promise<JournalEntryDetails> = post(
                    books,
                    '2026-06-01',
                    [['bank', 'debit', '1'], ['revenue', 'credit', '1']]
                );
                await expect(posting).rejects.toThrow(ConflictError);
                await expect(posting).rejects.toThrow(
                    'The posting date 2026-06-01 needs to fall into an open fiscal year, '
                    + 'and the fiscal year from 2026-01-01 to 2026-12-31 is closed.'
                );
                await expect(close(books)).rejects.toThrow('The fiscal year from 2026-01-01 to 2026-12-31 is closed already.');
                const next: JournalEntryDetails = await post(books, '2027-02-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);
                expect(next.entry.sequence).toBe(2);
            });

            it('opens the next year that exists already, and refuses to close it before the year before', async () => {
                const books: TestBooks = await createBooks();
                const next: FiscalYear = await inTenant(books.tenantId, async () => await journal().createFiscalYear({}));
                await post(books, '2026-01-02', [['bank', 'debit', '100'], ['capital', 'credit', '100']]);
                await post(books, '2027-01-05', [['rent', 'debit', '10'], ['bank', 'credit', '10']]);

                await expect(close(books, next.id))
                    .rejects.toThrow('The fiscal year from 2026-01-01 to 2026-12-31 needs to be closed before the fiscal year after it.');
                const closed: FiscalYearClosingResult = await close(books);

                expect(closed.nextFiscalYear.id).toBe(next.id);
                expect(closed.closingEntry).toBeNull();
                expect(closed.openingEntry?.entry.sequence).toBe(2);
                expect(describeLines(books, closed.openingEntry?.lines ?? []))
                    .toEqual([['bank', 'debit', '100.00'], ['capital', 'credit', '100.00']]);
            });

            it('refuses a result account that is not an equity account of the books', async () => {
                const books: TestBooks = await createBooks();

                await expect(inTenant(books.tenantId, async () => await journal().closeFiscalYear(
                    books.fiscalYear.id,
                    { resultAccountId: books.accounts.bank.id }
                ))).rejects.toThrow('The result account needs to be an equity account of the books.');
                expect((await inTenant(books.tenantId, async () => await fiscalYears().findById(books.fiscalYear.id))).closedAt).toBeNull();
            });

            it('is refused by a conformance of the legal form of the tenant, and leaves the year open', async () => {
                const books: TestBooks = await createBooks('Refusing GmbH');
                await postYear(books);

                await expect(close(books)).rejects.toThrow(`The fiscal year ${books.fiscalYear.id} needs to be closed by hand.`);

                const fiscalYear: FiscalYear = await inTenant(
                    books.tenantId,
                    async () => await fiscalYears().findById(books.fiscalYear.id)
                );
                expect(fiscalYear).toMatchObject({ closedAt: null, lastSequence: 4 });
                expect(await inTenant(books.tenantId, async () => await fiscalYears().count())).toBe(1);
            });

            it('applies the conformances a fiscal year names in place of those of the legal form', async () => {
                const books: TestBooks = await createBooks('UG');
                await inTenant(
                    books.tenantId,
                    async () => await fiscalYears().updateById(books.fiscalYear.id, { conformances: ['test-refusing'] })
                );
                await postYear(books);

                expect(await inTenant(books.tenantId, async () => await journal().resolveClosingProposals(books.fiscalYear.id)))
                    .toEqual([]);
                await expect(close(books)).rejects.toThrow(`The fiscal year ${books.fiscalYear.id} needs to be closed by hand.`);

                await inTenant(books.tenantId, async () => await fiscalYears().updateById(books.fiscalYear.id, { conformances: [] }));
                expect((await close(books)).fiscalYear.closedAt).toBeInstanceOf(Date);
            });

            it('proposes the entries of a conformance, which are posted before the year is closed', async () => {
                const books: TestBooks = await createBooks('UG');
                await postYear(books);

                const proposals: BookkeepingClosingProposal[] = await inTenant(
                    books.tenantId,
                    async () => await journal().resolveClosingProposals(books.fiscalYear.id)
                );
                await expect(close(books)).rejects.toThrow('The reserve needs to be posted before the fiscal year is closed.');
                expect(proposals).toHaveLength(1);
                expect(proposals[0]?.conformance).toBe('test-reserve');
                const proposed: NewJournalEntry | undefined = proposals[0]?.entry;
                expect(proposed?.lines.map(l => [l.accountId, l.debit?.toFixed(2), l.credit?.toFixed(2)])).toEqual([
                    [books.accounts.result.id, '125.00', undefined],
                    [books.accounts.reserve.id, undefined, '125.00']
                ]);

                await inTenant(books.tenantId, async () => await journal().post(proposed ?? entryOf(books, '2026-12-31', [])));
                const closed: FiscalYearClosingResult = await close(books);

                expect(await inTenant(books.tenantId, async () => await journal().resolveClosingProposals(books.fiscalYear.id)))
                    .toEqual([]);
                expect(describeLines(books, closed.openingEntry?.lines ?? [])).toEqual([
                    ['bank', 'debit', '25690.00'],
                    ['capital', 'credit', '25000.00'],
                    ['reserve', 'credit', '125.00'],
                    ['result', 'credit', '375.00'],
                    ['vat', 'credit', '190.00']
                ]);
            });

            describe('reopening it', () => {
                async function reopen(books: TestBooks, fiscalYearId: string = books.fiscalYear.id): Promise<FiscalYearReopeningResult> {
                    return inTenant(books.tenantId, async () => await journal().reopenFiscalYear(
                        fiscalYearId,
                        { reason: 'Rent refunded', createdBy: 'ada' }
                    ));
                }

                it('reverses the closing and the opening balances of the next year, and closes it again with a correction', async () => {
                    const books: TestBooks = await createBooks();
                    await postYear(books);
                    const first: FiscalYearClosingResult = await close(books);
                    await post(books, '2027-02-01', [['rent', 'debit', '50'], ['bank', 'credit', '50']]);
                    const statements: () => Promise<FiscalYearStatement[]> = async () => await inTenant(
                        books.tenantId,
                        async () => await inject<Repository<FiscalYearStatement>>(repositoryTokenFor(FiscalYearStatement))
                            .findAll({ where: { fiscalYearId: books.fiscalYear.id }, order: { chainSequence: 'ASC' }, limit: 'all' })
                    );
                    const archived: FiscalYearStatement[] = await statements();

                    const reopened: FiscalYearReopeningResult = await reopen(books);

                    expect([reopened.fiscalYear.closedAt, reopened.fiscalYear.reopenings]).toEqual([null, 1]);
                    // each reversed as an entry is corrected, naming it, with the reason
                    expect(reopened.closingReversal?.entry).toMatchObject({
                        fiscalYearId: books.fiscalYear.id,
                        postingDate: day('2026-12-31'),
                        reversesEntryId: first.closingEntry?.entry.id,
                        sourceType: 'bookkeeping.closing',
                        sourceId: `${books.fiscalYear.id}:reopening-1`,
                        createdBy: 'ada',
                        text: 'Reopening of the fiscal year from 2026-01-01 to 2026-12-31: Rent refunded'
                    });
                    expect(describeLines(books, reopened.closingReversal?.lines ?? [])).toEqual([
                        ['rent', 'debit', '500.00'],
                        ['revenue', 'credit', '1000.00'],
                        ['result', 'debit', '500.00']
                    ]);
                    expect(reopened.openingReversal?.entry).toMatchObject({
                        fiscalYearId: first.nextFiscalYear.id,
                        postingDate: day('2027-01-01'),
                        reversesEntryId: first.openingEntry?.entry.id,
                        sourceType: 'bookkeeping.opening'
                    });
                    expect(await inTenant(
                        books.tenantId,
                        async () => (await journal().resolveCarriedBalances(first.nextFiscalYear.id)).balances
                            .filter(b => !b.debit.minus(b.credit).isZero())
                    )).toEqual([]);

                    // posted into again, and closed again with the correction
                    await post(books, '2026-12-30', [['bank', 'debit', '100'], ['rent', 'credit', '100']]);
                    const second: FiscalYearClosingResult = await close(books);

                    expect(second.closingEntry?.entry).toMatchObject({
                        sourceType: 'bookkeeping.closing',
                        sourceId: `${books.fiscalYear.id}:closing-2`,
                        reversesEntryId: null
                    });
                    expect(describeLines(books, second.closingEntry?.lines ?? [])).toEqual([
                        ['rent', 'credit', '400.00'],
                        ['revenue', 'debit', '1000.00'],
                        ['result', 'credit', '600.00']
                    ]);
                    expect(second.nextFiscalYear.id).toBe(first.nextFiscalYear.id);
                    expect(describeLines(books, second.openingEntry?.lines ?? [])).toEqual([
                        ['bank', 'debit', '25790.00'],
                        ['capital', 'credit', '25000.00'],
                        ['result', 'credit', '600.00'],
                        ['vat', 'credit', '190.00']
                    ]);
                    // the opening balances of the next year are those of the latest closing, and its own entry stays. The
                    // equity accounts of the cases are in no position, which reads them as carry-forward accounts
                    const carried: BookkeepingCarriedBalances = await inTenant(
                        books.tenantId,
                        async () => await journal().resolveCarriedBalances(first.nextFiscalYear.id)
                    );
                    expect(carried.balances.map(b => [b.account.number, b.debit.minus(b.credit).toFixed(2)])).toEqual([
                        ['1200', '25790.00'],
                        ['3806', '-190.00']
                    ]);
                    expect(await inTenant(
                        books.tenantId,
                        async () => await entries().count({ where: { fiscalYearId: first.nextFiscalYear.id, sourceType: null } })
                    )).toBe(1);

                    // the statements of the first closing stay archived as they were, beside those of the second, which count
                    const after: FiscalYearStatement[] = await statements();
                    expect(after.slice(0, archived.length)).toEqual(archived);
                    expect(after.map(s => s.closing)).toEqual([...archived.map(() => 1), ...archived.map(() => 2)]);
                    const balanceSheet: FiscalYearStatement | undefined = await inTenant(
                        books.tenantId,
                        async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE)
                            .findArchivedStatement(second.fiscalYear, BookkeepingStatementType.BALANCE_SHEET, undefined)
                    );
                    expect(balanceSheet?.closing).toBe(2);
                    expect((await inTenant(books.tenantId, async () => await journal().resolveVerification())).intact).toBe(true);
                });

                it('is the only way to reverse the entry closing a year and the opening entry of the next', async () => {
                    const books: TestBooks = await createBooks();
                    await postYear(books);
                    const closed: FiscalYearClosingResult = await close(books);
                    const reverse: (entryId?: string) => Promise<JournalEntryDetails> = async (entryId = '') => await inTenant(
                        books.tenantId,
                        async () => await journal().reverse(entryId, { postingDate: day('2027-01-05'), text: 'Undone by hand' })
                    );

                    await expect(reverse(closed.closingEntry?.entry.id)).rejects.toThrow(ConflictError);
                    await expect(reverse(closed.closingEntry?.entry.id))
                        .rejects.toThrow('is reversed only by reopening that fiscal year');
                    await expect(reverse(closed.openingEntry?.entry.id))
                        .rejects.toThrow('Reopen it with POST /fiscal-years/:id/reopening.');
                    // and so is the reversal a reopening posted
                    const reopened: FiscalYearReopeningResult = await reopen(books);
                    await expect(reverse(reopened.openingReversal?.entry.id))
                        .rejects.toThrow('is reversed only by reopening that fiscal year');
                    expect(await inTenant(books.tenantId, async () => await entries().count({ where: { text: 'Undone by hand' } })))
                        .toBe(0);
                });

                it('refuses an open year, and one whose next year is closed, which is reopened first, the latest first', async () => {
                    const books: TestBooks = await createBooks();
                    await postYear(books);

                    await expect(reopen(books))
                        .rejects.toThrow('The fiscal year from 2026-01-01 to 2026-12-31 is open, and only a closed one is reopened.');
                    const first: FiscalYearClosingResult = await close(books);
                    await close(books, first.nextFiscalYear.id);

                    await expect(reopen(books)).rejects.toThrow(ConflictError);
                    await expect(reopen(books)).rejects.toThrow(
                        'The fiscal year from 2027-01-01 to 2027-12-31 needs to be reopened before the fiscal year before it, '
                        + 'as it opened with its closing.'
                    );
                    expect((await reopen(books, first.nextFiscalYear.id)).fiscalYear.closedAt).toBeNull();
                    expect((await reopen(books)).fiscalYear.reopenings).toBe(1);
                    // a year reopened is open, and reopened again only once closed again
                    await expect(reopen(books)).rejects.toThrow('is open, and only a closed one is reopened.');
                });
            });
        });

        describe('listing the entries', () => {
            it('answers a page by posting date and sequence, narrowed by fiscal year, days and account, '
                + 'with the count of every entry matching', async () => {
                const books: TestBooks = await createBooks();
                const capital: JournalEntryDetails = await post(
                    books,
                    '2026-01-10',
                    [['bank', 'debit', '1000'], ['capital', 'credit', '1000']]
                );
                const sale: JournalEntryDetails = await post(
                    books,
                    '2026-02-01',
                    [['bank', 'debit', '119'], ['revenue', 'credit', '100'], ['vat', 'credit', '19']]
                );
                const rent: JournalEntryDetails = await post(books, '2026-02-15', [['rent', 'debit', '50'], ['bank', 'credit', '50']]);
                const invoice: JournalEntryDetails = await post(
                    books,
                    '2026-03-01',
                    [['receivables', 'debit', '20'], ['revenue', 'credit', '20']]
                );
                // posted later on the same day as the sale, so after it by sequence
                const second: JournalEntryDetails = await post(books, '2026-02-01', [['bank', 'debit', '5'], ['capital', 'credit', '5']]);
                const find: (page: number, limit: number, filter: JournalEntryFilter) => Promise<[number, string[]]> = async (
                    page,
                    limit,
                    filter
                ) => {
                    const found: PaginationResult<JournalEntryDetails> = await inTenant(
                        books.tenantId,
                        async () => await journal().findEntries(page, limit, filter)
                    );
                    return [found.totalAmount, found.items.map(i => i.entry.id)];
                };

                expect(await find(1, 2, {})).toEqual([5, [capital.entry.id, sale.entry.id]]);
                expect(await find(2, 2, { fiscalYearId: books.fiscalYear.id })).toEqual([5, [second.entry.id, rent.entry.id]]);
                expect(await find(1, 10, { from: day('2026-02-01'), until: day('2026-02-28') }))
                    .toEqual([3, [sale.entry.id, second.entry.id, rent.entry.id]]);
                expect(await find(1, 10, { from: day('2026-02-16') })).toEqual([1, [invoice.entry.id]]);
                expect(await find(1, 10, { until: day('2026-01-31') })).toEqual([1, [capital.entry.id]]);
                expect(await find(1, 10, { accountId: books.accounts.revenue.id })).toEqual([2, [sale.entry.id, invoice.entry.id]]);
                expect(await find(2, 2, { accountId: books.accounts.bank.id })).toEqual([4, [second.entry.id, rent.entry.id]]);
                expect(await find(3, 2, { accountId: books.accounts.bank.id })).toEqual([4, []]);
                expect(await find(1, 10, { accountId: books.accounts.bank.id, from: day('2026-02-01'), until: day('2026-02-01') }))
                    .toEqual([2, [sale.entry.id, second.entry.id]]);
                expect(await find(1, 10, { accountId: books.accounts.reserve.id })).toEqual([0, []]);

                // each with all of its lines, not only those on the account
                const page: PaginationResult<JournalEntryDetails> = await inTenant(
                    books.tenantId,
                    async () => await journal().findEntries(1, 1, { accountId: books.accounts.vat.id })
                );
                expect(describeLines(books, page.items[0]?.lines ?? [])).toEqual([
                    ['bank', 'debit', '119.00'],
                    ['revenue', 'credit', '100.00'],
                    ['vat', 'credit', '19.00']
                ]);
            });

            it('adds up the lines of every entry matching, not only of the page, and those on the account named', async () => {
                const books: TestBooks = await createBooks();
                await post(books, '2026-01-10', [['bank', 'debit', '1000'], ['capital', 'credit', '1000']]);
                await post(books, '2026-02-01', [['bank', 'debit', '119'], ['revenue', 'credit', '100'], ['vat', 'credit', '19']]);
                await post(books, '2026-02-15', [['rent', 'debit', '50'], ['bank', 'credit', '50']]);
                const totals: (filter: JournalEntryFilter) => Promise<[number, string, string]> = async filter => {
                    const found: JournalEntryPage = await inTenant(books.tenantId, async () => await journal().findEntries(1, 1, filter));
                    return [found.items.length, found.debit.toFixed(2), found.credit.toFixed(2)];
                };

                expect(await totals({})).toEqual([1, '1169.00', '1169.00']);
                expect(await totals({ from: day('2026-02-01') })).toEqual([1, '169.00', '169.00']);
                expect(await totals({ accountId: books.accounts.bank.id })).toEqual([1, '1119.00', '50.00']);
                expect(await totals({ accountId: books.accounts.reserve.id })).toEqual([0, '0.00', '0.00']);
            });

            it('names the entry reversing an entry, read from the reversal, on every read of it', async () => {
                const books: TestBooks = await createBooks();
                const sale: JournalEntryDetails = await post(
                    books,
                    '2026-02-01',
                    [['bank', 'debit', '119'], ['revenue', 'credit', '100'], ['vat', 'credit', '19']]
                );
                const rent: JournalEntryDetails = await post(books, '2026-02-15', [['rent', 'debit', '50'], ['bank', 'credit', '50']]);

                const reversal: JournalEntryDetails = await inTenant(books.tenantId, async () => await journal().reverse(
                    sale.entry.id,
                    { postingDate: day('2026-02-20'), text: 'Wrong' }
                ));

                expect([sale.reversedByEntryId, reversal.reversedByEntryId]).toEqual([null, null]);
                expect((await inTenant(books.tenantId, async () => await journal().findEntry(sale.entry.id))).reversedByEntryId)
                    .toBe(reversal.entry.id);
                const page: JournalEntryPage = await inTenant(books.tenantId, async () => await journal().findEntries(1, 10, {}));
                expect(page.items.map(i => [i.entry.id, i.reversedByEntryId])).toEqual([
                    [sale.entry.id, reversal.entry.id],
                    [rent.entry.id, null],
                    [reversal.entry.id, null]
                ]);
                const report: BookkeepingJournalReport = await inTenant(
                    books.tenantId,
                    async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE)
                        .resolveJournal(day('2026-02-01'), day('2026-02-28'))
                );
                expect(report.entries.map(i => i.reversedByEntryId)).toEqual([reversal.entry.id, null, null]);
            });
        });

        describe('finding the accounts of the books', () => {
            it('finds them by the start of their number or by their name, whatever its case, and open or closed', async () => {
                const books: TestBooks = await createBooks();
                await inTenant(
                    books.tenantId,
                    async () => await inject<Repository<BookkeepingAccount>>(repositoryTokenFor(BookkeepingAccount))
                        .updateById(books.accounts.reserve.id, { closedAt: new Date() })
                );
                const find: (filter: BookkeepingAccountFilter) => Promise<string[]> = async filter => (await inTenant(
                    books.tenantId,
                    async () => await journal().findAccounts(filter)
                )).map(a => a.number);

                expect(await find({})).toEqual(['1200', '1400', '2900', '2930', '2970', '3806', '4210', '8400']);
                expect(await find({ search: '29' })).toEqual(['2900', '2930', '2970']);
                // the number from its start, the name anywhere
                expect(await find({ search: '00' })).toEqual([]);
                expect(await find({ search: ' CAPITAL ' })).toEqual(['2900']);
                expect(await find({ search: '%' })).toEqual(['3806', '8400']);
                expect(await find({ search: '29', open: true })).toEqual(['2900', '2970']);
                expect(await find({ open: false })).toEqual(['2930']);
            });
        });

        describe('listing the entries of a filter that is not one', () => {

            it('refuses days with a time, an until before the from, and an account that is not one of the books', async () => {
                const books: TestBooks = await createBooks();
                const other: TestBooks = await createBooks();
                const find: (filter: JournalEntryFilter) => Promise<PaginationResult<JournalEntryDetails>> = async filter => await inTenant(
                    books.tenantId,
                    async () => await journal().findEntries(1, 10, filter)
                );

                await expect(find({ from: new Date('2026-02-01T12:00:00.000Z') })).rejects.toThrow(BadRequestError);
                await expect(find({ from: new Date('2026-02-01T12:00:00.000Z') }))
                    .rejects.toThrow('The from needs to be a day without a time, such as 2026-03-31.');
                await expect(find({ until: new Date('2026-02-01T12:00:00.000Z') }))
                    .rejects.toThrow('The until needs to be a day without a time, such as 2026-03-31.');
                await expect(find({ from: day('2026-02-01'), until: day('2026-01-31') }))
                    .rejects.toThrow('The until needs to be on or after the from, 2026-02-01.');
                await expect(find({ accountId: other.accounts.bank.id })).rejects.toThrow(BadRequestError);
                await expect(find({ accountId: other.accounts.bank.id }))
                    .rejects.toThrow(`The accountId needs to be an account of the books, and "${other.accounts.bank.id}" is none.`);
            });
        });

        describe('the books of a tenant', () => {
            it('are invisible to another tenant', async () => {
                const books: TestBooks = await createBooks();
                const other: TestBooks = await createBooks();
                const posted: JournalEntryDetails = await post(books, '2026-03-01', [['bank', 'debit', '1'], ['revenue', 'credit', '1']]);
                const own: JournalEntryDetails = await post(other, '2026-03-01', [['bank', 'debit', '2'], ['revenue', 'credit', '2']]);

                await expect(inTenant(other.tenantId, async () => await journal().findEntry(posted.entry.id)))
                    .rejects.toThrow(NotFoundError);
                await expect(inTenant(other.tenantId, async () => await journal().reverse(
                    posted.entry.id,
                    { postingDate: day('2026-03-02'), text: 'x' }
                ))).rejects.toThrow(NotFoundError);
                const page: PaginationResult<JournalEntryDetails> = await inTenant(
                    other.tenantId,
                    async () => await journal().findEntries(1, 10, {})
                );
                expect(page.items.map(i => i.entry.id)).toEqual([own.entry.id]);
                expect(page.items[0]?.lines).toHaveLength(2);
                // each tenant's entries are a chain of their own
                expect([posted.entry.chainSequence, own.entry.chainSequence]).toEqual([1, 1]);
            });
        });
    });
}