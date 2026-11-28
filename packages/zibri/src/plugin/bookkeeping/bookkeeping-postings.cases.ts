/* eslint-disable cspell/spellchecker */
import { describe, expect, it, jest } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { type StartTransactionOptions } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { BigNumber } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ApprovalActorKind } from '../approval/models/approval-actor-kind.enum';
import { ApprovalDecision } from '../approval/models/approval-decision.model';
import { type ApprovalRequestDetails } from '../approval/models/approval-request-details.model';
import { ApprovalRequestStatus } from '../approval/models/approval-request-status.enum';
import { ApprovalRequest } from '../approval/models/approval-request.model';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank/bank.tokens';
import { BankAccount, BankAccountCreateData } from '../bank/models/bank-account.model';
import { BankMatchTargetType } from '../bank/models/bank-match-target-type.enum';
import { BankMatch } from '../bank/models/bank-match.model';
import { BankPluginOptionsInput } from '../bank/models/bank-plugin-options-input.model';
import { BANK_STATEMENT_FILE_STORE_NAME } from '../bank/models/bank-statement-file-store-name.model';
import { BankStatement } from '../bank/models/bank-statement.model';
import { BankTransactionState } from '../bank/models/bank-transaction-state.model';
import { BankTransaction } from '../bank/models/bank-transaction.model';
import { type BankMatchServiceInterface } from '../bank/services/bank-match-service.interface';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { InvoiceItem } from '../invoicing/models/invoice-item.model';
import { type InvoicePaymentState } from '../invoicing/models/invoice-payment-state.model';
import { InvoiceRecipientAbbreviation } from '../invoicing/models/invoice-recipient-abbreviation.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { NumberInvoices } from '../invoicing/models/number-invoices.model';
import { type InvoiceCalcServiceInterface } from '../invoicing/services/invoice-calc-service.interface';
import { type InvoiceCancellationServiceInterface } from '../invoicing/services/invoice-cancellation-service.interface';
import { bookkeepingTestEntities, day, describeLines, inTenant, journal, ReceiptsFileStore, testCompany } from './bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { AccountMatchRule } from './models/account-match-rule.model';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { BookkeepingAccount, BookkeepingAccountCreateData } from './models/bookkeeping-account.model';
import { type ExpenseData } from './models/expense-data.model';
import { Expense } from './models/expense.model';
import { FiscalYear } from './models/fiscal-year.model';
import { type JournalEntryDetails } from './models/journal-entry-details.model';
import { JournalEntry } from './models/journal-entry.model';
import { type PostingRuleSet } from './models/posting-rule-set.model';
import { type PostingRules } from './models/posting-rules.model';
import { PostingSourceType } from './models/posting-source-type.enum';
import { type ExpenseServiceInterface } from './services/expense-service.interface';
import { type PostingRuleServiceInterface } from './services/posting-rule-service.interface';
import { type PostingServiceInterface } from './services/posting-service.interface';

/**
 * The cases every data source answers the same way about what the bookkeeping plugin posts of invoices, credit notes,
 * expenses and bank matches. A file per data source runs them, with {@link postingTestEntities}, the file stores of
 * {@link postingTestFileStores} and the providers of {@link postingTestProviders}, and the bookkeeping, the invoicing,
 * the approval and the bank plugin registered.
 */

/**
 * The folder the original files of the bank statements of the cases are kept in, which the cases import none of.
 */
export const statementsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bookkeeping-statements-${UUIDUtilities.generate()}`);

/**
 * The file store of the bank statements, which the bank plugin needs.
 */
@FileStore()
export class StatementsFileStore extends FsFileStore {
    constructor() {
        super(BANK_STATEMENT_FILE_STORE_NAME, statementsFolder);
    }
}

/**
 * The file stores of the cases.
 */
export const postingTestFileStores: Newable<FsFileStore>[] = [ReceiptsFileStore, StatementsFileStore];

/**
 * The entities the cases need, besides those of a test server.
 */
export const postingTestEntities: Newable<BaseEntity>[] = [
    ...bookkeepingTestEntities,
    Invoice,
    NumberInvoices,
    InvoiceRecipientAbbreviation,
    BankAccount,
    BankStatement,
    BankTransaction,
    BankTransactionState,
    BankMatch,
    ApprovalRequest,
    ApprovalDecision,
    AccountMatchRule
];

/**
 * How far an invoice paid short counts as paid in the cases.
 */
const TOLERANCE: number = 5;

/**
 * The providers of the cases: a tenant without books posts nothing, the bank plugin matches with a tolerance of 5 and
 * approves what it is sure of, and every tenant issues its invoices as one company.
 */
export const postingTestProviders: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'post-nothing' } }),
    defineProvider<BankPluginOptionsInput>({
        token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { matching: { autoApproveConfidence: 0.95, paymentDifferenceTolerance: TOLERANCE } }
    }),
    companyInfoProvider(() => ({
        name: 'Example Company',
        fullName: 'Example Company LLC',
        email: 'info@example-company.com',
        phone: '12345 67890123',
        timezone: 'Europe/Berlin',
        address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
        taxNumber: '123/456/78910',
        vatNumber: 'DE123456789',
        ceo: 'James Smith',
        iban: 'DE75512108001245126199',
        bic: 'ABCDDEFFXXX'
    }))
];

/**
 * The accounts of the books of the cases, by what they are called in them, named after the SKR 03.
 */
export type PostingAccountName = 'bank' | 'receivables' | 'payables' | 'outputTax19' | 'outputTax7' | 'inputTax19' | 'revenue19'
    | 'revenue7' | 'revenueExempt' | 'difference19' | 'difference7' | 'rent' | 'vatPrepayment' | 'capital' | 'result';

const ACCOUNTS: Record<PostingAccountName, Pick<BookkeepingAccountCreateData, 'number' | 'name' | 'type'>> = {
    bank: { number: '1200', name: 'Bank', type: BookkeepingAccountType.ASSET },
    receivables: { number: '1400', name: 'Receivables', type: BookkeepingAccountType.ASSET },
    inputTax19: { number: '1576', name: 'Input tax 19 %', type: BookkeepingAccountType.ASSET },
    payables: { number: '1600', name: 'Payables', type: BookkeepingAccountType.LIABILITY },
    outputTax7: { number: '1771', name: 'Output tax 7 %', type: BookkeepingAccountType.LIABILITY },
    outputTax19: { number: '1776', name: 'Output tax 19 %', type: BookkeepingAccountType.LIABILITY },
    vatPrepayment: { number: '1780', name: 'VAT prepayments', type: BookkeepingAccountType.LIABILITY },
    capital: { number: '2900', name: 'Share capital', type: BookkeepingAccountType.EQUITY },
    result: { number: '2970', name: 'Profit carried forward', type: BookkeepingAccountType.EQUITY },
    rent: { number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE },
    revenueExempt: { number: '8100', name: 'Revenue exempt from VAT', type: BookkeepingAccountType.REVENUE },
    revenue7: { number: '8300', name: 'Revenue 7 %', type: BookkeepingAccountType.REVENUE },
    revenue19: { number: '8400', name: 'Revenue 19 %', type: BookkeepingAccountType.REVENUE },
    difference7: { number: '8731', name: 'Payment differences 7 %', type: BookkeepingAccountType.REVENUE },
    difference19: { number: '8736', name: 'Payment differences 19 %', type: BookkeepingAccountType.REVENUE }
};

/**
 * The books of a tenant of its own, with a bank account and the posting rules of 2026.
 */
export type PostingBooks = {

    tenantId: string,

    accounts: Record<PostingAccountName, BookkeepingAccount>,
    /**
     * The fiscal year 2026.
     */
    fiscalYear: FiscalYear,
    /**
     * Its rule set, valid from its first day.
     */
    ruleSet: PostingRuleSet,

    bankAccount: BankAccount
};

const siemens: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'Siemens AG',
    countryId: 'DE'
};

const FIRST_NUMBER: string = '2026-SIEMEN-0001';
const SECOND_NUMBER: string = '2026-SIEMEN-0002';
const COUNTERPARTY_NAME: string = 'SIEMENS AG';
const INVOICE_DAY: string = '2026-03-01';
const DRAFT_DATE: string = '2026-04-01T12:00:00.000Z';
const JULY_FIRST: string = '2026-07-01';

function invoices(): Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> {
    return inject(repositoryTokenFor(Invoice));
}

function entries(): Repository<JournalEntry> {
    return inject(repositoryTokenFor(JournalEntry));
}

function postings(): PostingServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE);
}

function postingRules(): PostingRuleServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE);
}

function expenses(): ExpenseServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
}

function bankMatches(): BankMatchServiceInterface {
    return inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE);
}

/**
 * An item of one hour of consulting.
 * @param price - Its net price.
 * @param rate - Its VAT rate, 19 % by default.
 * @param categoryCode - Its VAT category, `S` by default.
 * @returns The item.
 */
export function itemOf(price: number, rate: number = 19, categoryCode: string = 'S'): InvoiceItem {
    return {
        name: 'Consulting',
        amount: 1,
        amountUnit: { code: 'HUR', displayName: 'Hours' },
        vat: { categoryCode, rate, exemptionReason: categoryCode === 'E' ? 'Small business, § 19 UStG' : null },
        price
    };
}

/**
 * The rules of the cases: every account they name.
 * @param accounts - The accounts.
 * @returns The rules.
 */
function rulesOf(accounts: Record<PostingAccountName, BookkeepingAccount>, bankAccountId: string): PostingRules {
    return {
        receivablesAccountId: accounts.receivables.id,
        payablesAccountId: accounts.payables.id,
        revenueAccounts: [
            { categoryCode: 'S', rate: 19, accountId: accounts.revenue19.id },
            { categoryCode: 'S', rate: 7, accountId: accounts.revenue7.id },
            { categoryCode: 'E', rate: 0, accountId: accounts.revenueExempt.id }
        ],
        outputTaxAccounts: [{ rate: 19, accountId: accounts.outputTax19.id }, { rate: 7, accountId: accounts.outputTax7.id }],
        inputTaxAccounts: [{ rate: 19, accountId: accounts.inputTax19.id }],
        paymentDifferenceAccounts: [{ rate: 19, accountId: accounts.difference19.id }, { rate: 7, accountId: accounts.difference7.id }],
        bankAccounts: [{ bankAccountId, accountId: accounts.bank.id }]
    };
}

/**
 * Starts the books of a new tenant: its settings, accounts, bank account, fiscal year 2026 and posting rules.
 * @param rules - The rules of 2026, those of {@link rulesOf} by default.
 * @returns The books.
 */
export async function createPostingBooks(
    rules?: (accounts: Record<PostingAccountName, BookkeepingAccount>, bankAccountId: string) => PostingRules
): Promise<PostingBooks> {
    const tenantId: string = UUIDUtilities.generate();
    return await inTenant(tenantId, async () => {
        await journal().createSettings({
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
            company: testCompany
        });
        const repository: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
        // in one write: one at a time, the accounts were most of what a case against postgres cost
        const created: Map<string, BookkeepingAccount> = new Map((await repository.createAll(
            Object.values(ACCOUNTS).map(account => ({ ...account, statementPosition: null }))
        )).map(account => [account.number, account]));
        const accountOf: (name: PostingAccountName) => BookkeepingAccount = name => {
            const account: BookkeepingAccount | undefined = created.get(ACCOUNTS[name].number);
            if (account == undefined) {
                throw new Error(`The account ${name} was not created.`);
            }
            return account;
        };
        const accounts: Record<PostingAccountName, BookkeepingAccount> = {
            bank: accountOf('bank'),
            receivables: accountOf('receivables'),
            payables: accountOf('payables'),
            outputTax19: accountOf('outputTax19'),
            outputTax7: accountOf('outputTax7'),
            inputTax19: accountOf('inputTax19'),
            revenue19: accountOf('revenue19'),
            revenue7: accountOf('revenue7'),
            revenueExempt: accountOf('revenueExempt'),
            difference19: accountOf('difference19'),
            difference7: accountOf('difference7'),
            rent: accountOf('rent'),
            vatPrepayment: accountOf('vatPrepayment'),
            capital: accountOf('capital'),
            result: accountOf('result')
        };
        const bankAccount: BankAccount = await inject<Repository<BankAccount, BankAccountCreateData>>(repositoryTokenFor(BankAccount))
            .create({ iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' });
        const fiscalYear: FiscalYear = await journal().createFiscalYear({ start: day('2026-01-01'), founded: true });
        const ruleSet: PostingRuleSet = await postingRules().createRuleSet({
            fiscalYearId: fiscalYear.id,
            rules: (rules ?? rulesOf)(accounts, bankAccount.id)
        });
        return { tenantId, accounts, fiscalYear, ruleSet, bankAccount };
    });
}

/**
 * Creates an issued invoice, or a draft by a number starting with `TEMP-`.
 * @param books - The books.
 * @param number - The number of the invoice.
 * @param items - The items.
 * @param date - The day of the invoice, such as `2026-03-01`.
 * @param transaction - The transaction, none by default.
 * @returns The invoice.
 */
export async function issueInvoice(
    books: PostingBooks,
    number: string,
    items: InvoiceItem[],
    date: string = INVOICE_DAY,
    transaction?: Transaction
): Promise<Invoice> {
    return await inTenant(books.tenantId, async () => await invoices().create(
        {
            number,
            currency: 'EUR',
            items,
            date: new Date(`${date}T12:00:00.000Z`),
            performanceDate: new Date(`${date}T12:00:00.000Z`),
            dueDate: new Date(`${date}T12:00:00.000Z`),
            customerAddressData: siemens,
            textBeforeItems: [],
            textAfterItems: [],
            issuedAt: number.startsWith('TEMP-') ? null : new Date()
        },
        { transaction }
    ));
}

/**
 * Finds the entry posted of a source, with its lines.
 * @param books - The books.
 * @param sourceType - The kind of source.
 * @param sourceId - The id of the source.
 * @returns The entry, or undefined when none was posted.
 */
async function findEntryOf(books: PostingBooks, sourceType: PostingSourceType, sourceId: string): Promise<JournalEntryDetails | undefined> {
    return await inTenant(books.tenantId, async () => {
        const entry: JournalEntry | undefined = await postings().findEntryOf(sourceType, sourceId);
        return entry == undefined ? undefined : await journal().findEntry(entry.id);
    });
}

/**
 * The lines of the entry of a source, as the cases write them.
 * @param books - The books.
 * @param sourceType - The kind of source.
 * @param sourceId - The id of the source.
 * @returns Each line as the name of its account, its side and its amount.
 */
async function describeEntryOf(
    books: PostingBooks,
    sourceType: PostingSourceType,
    sourceId: string
): Promise<[string, 'debit' | 'credit', string][]> {
    const entry: JournalEntryDetails | undefined = await findEntryOf(books, sourceType, sourceId);
    if (entry == undefined) {
        throw new Error(`Nothing is posted of ${sourceType} ${sourceId}.`);
    }
    return describeLines(books, entry.lines);
}

/**
 * Gets the one request of suggestions.
 * @param suggestions - The suggestions.
 * @returns Its request.
 */
function single(suggestions: ApprovalRequestDetails[]): ApprovalRequest {
    expect(suggestions).toHaveLength(1);
    const [suggestion] = suggestions;
    if (suggestion == undefined) {
        throw new Error('No suggestion.');
    }
    return suggestion.request;
}

/**
 * Creates a transaction of the bank account of the books.
 * @param books - The books.
 * @param amount - The amount, negative for money paid.
 * @param data - The counterparty and the remittance information.
 * @returns The transaction.
 */
export async function createTransaction(
    books: PostingBooks,
    amount: string,
    data: Pick<BankTransaction, 'counterpartyName' | 'counterpartyIban' | 'remittanceInformation'>
): Promise<BankTransaction> {
    return await inTenant(books.tenantId, async () => await inject<
        Repository<BankTransaction, OmitStrict<BankTransaction, 'id' | 'tenantId'>>
    >(
        repositoryTokenFor(BankTransaction)
    ).create({
        accountId: books.bankAccount.id,
        statementId: UUIDUtilities.generate(),
        bookingDate: new Date('2026-03-20T12:00:00.000Z'),
        valueDate: null,
        amount: new BigNumber(amount),
        currency: 'EUR',
        endToEndId: null,
        mandateId: null,
        creditorId: null,
        bankReference: null,
        deduplicationKey: UUIDUtilities.generate(),
        ...data
    }));
}

/**
 * Suggests the matches of a transaction.
 * @param books - The books.
 * @param transaction - The transaction.
 * @returns The requests proposed.
 */
export async function suggest(books: PostingBooks, transaction: BankTransaction): Promise<ApprovalRequestDetails[]> {
    return await inTenant(books.tenantId, async () => await bankMatches().suggestMatches([transaction.id]));
}

/**
 * Confirms a match as a person does once they approve its request: the action of the request runs in a transaction.
 * @param books - The books.
 * @param request - The request.
 * @param transaction - The transaction matched.
 * @param targetType - What it is matched with.
 * @param targetId - The id of what it is matched with.
 * @param amount - The amount.
 * @returns The match.
 */
async function confirm(
    books: PostingBooks,
    request: ApprovalRequest,
    transaction: BankTransaction,
    targetType: BankMatchTargetType,
    targetId: string,
    amount: string
): Promise<BankMatch> {
    return await inTenant(books.tenantId, async () => await entries().dataSource.runInTransaction(
        async started => await bankMatches().createMatch(
            { transactionId: transaction.id, targetType, targetId, amount: new BigNumber(amount) },
            { transaction: started, request, decidedBy: 'ada', decidedByKind: ApprovalActorKind.USER }
        ),
        { maxAttempts: 1 }
    ));
}

/**
 * The payment state of an invoice, as its status, what is paid and what is open.
 * @param books - The books.
 * @param invoice - The invoice.
 * @returns The state, with the amounts in two decimals.
 */
async function findPaymentState(books: PostingBooks, invoice: Invoice): Promise<[string, string, string] | undefined> {
    const state: InvoicePaymentState | undefined = await inTenant(
        books.tenantId,
        async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE).resolvePaymentState(invoice)
    );
    return state == undefined ? undefined : [state.status, state.paid.toFixed(2), state.open.toFixed(2)];
}

/**
 * What the expense of the cases states: office supplies on the account of the rent, of 100.00 and 19.00 VAT.
 * @param books - The books.
 * @param data - What differs.
 * @returns The expense.
 */
export function rentOf(books: PostingBooks, data: Partial<ExpenseData> = {}): ExpenseData {
    return {
        supplier: { name: 'Office Supplies GmbH', address: 'Main Street 1\n12345 Berlin', vatId: 'DE987654321' },
        documentNumber: 'R-77',
        documentDate: day('2026-03-05'),
        dueDate: day('2026-03-19'),
        totals: [{ rate: 19, net: new BigNumber('100.00'), tax: new BigNumber('19.00') }],
        currency: 'EUR',
        accountId: books.accounts.rent.id,
        receiptId: null,
        ...data
    };
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeBookkeepingPostings(dataSourceName: string): void {
    describe(`the postings of the books on ${dataSourceName}`, () => {
        describe('issuing an invoice', () => {
            it('posts an invoice of 1.000 € without VAT as receivables to revenue', async () => {
                const books: PostingBooks = await createPostingBooks();

                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(1000, 0, 'E')]);

                expect(await describeEntryOf(books, PostingSourceType.INVOICE, invoice.id)).toEqual([
                    ['receivables', 'debit', '1000.00'],
                    ['revenueExempt', 'credit', '1000.00']
                ]);
                const entry: JournalEntryDetails | undefined = await findEntryOf(books, PostingSourceType.INVOICE, invoice.id);
                expect(entry?.entry).toMatchObject({
                    documentDate: day(INVOICE_DAY),
                    postingDate: day(INVOICE_DAY),
                    documentReference: FIRST_NUMBER,
                    text: `Invoice ${FIRST_NUMBER}`,
                    sourceType: 'invoicing.invoice',
                    sourceId: invoice.id
                });
            });

            it('posts the VAT of an invoice of 1.000 € with 19 % on the output tax account, '
                + 'by the amounts of the InvoiceCalcService', async () => {
                const books: PostingBooks = await createPostingBooks();

                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(333.33), itemOf(666.67)]);
                const mixed: Invoice = await issueInvoice(books, SECOND_NUMBER, [itemOf(100), itemOf(100, 7), itemOf(0.05, 7)]);

                expect(await describeEntryOf(books, PostingSourceType.INVOICE, invoice.id)).toEqual([
                    ['receivables', 'debit', '1190.00'],
                    ['revenue19', 'credit', '1000.00'],
                    ['outputTax19', 'credit', '190.00']
                ]);
                const calc: InvoiceCalcServiceInterface<Invoice> = inject<InvoiceCalcServiceInterface<Invoice>>(
                    ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE
                );
                expect([
                    (await calc.getTotalAfterTax(mixed)).toFixed(2),
                    (await calc.getTotalTaxForTaxGroup(mixed, { categoryCode: 'S', rate: 19 }, false)).toFixed(2),
                    (await calc.getTotalTaxForTaxGroup(mixed, { categoryCode: 'S', rate: 7 }, false)).toFixed(2)
                ]).toEqual(['226.05', '19.00', '7.00']);
                expect(await describeEntryOf(books, PostingSourceType.INVOICE, mixed.id)).toEqual([
                    ['receivables', 'debit', '226.05'],
                    ['revenue19', 'credit', '100.00'],
                    ['revenue7', 'credit', '100.05'],
                    ['outputTax19', 'credit', '19.00'],
                    ['outputTax7', 'credit', '7.00']
                ]);
            });

            it('posts nothing of a draft, and posts it once it is issued', async () => {
                const books: PostingBooks = await createPostingBooks();
                const draft: Invoice = await inTenant(books.tenantId, async () => await invoices().create({
                    number: 'TEMP-2026-SIEMEN-0001',
                    currency: 'EUR',
                    items: [itemOf(100)],
                    date: new Date(DRAFT_DATE),
                    performanceDate: new Date(DRAFT_DATE),
                    dueDate: new Date('2026-04-15T12:00:00.000Z'),
                    customerAddressData: siemens,
                    textBeforeItems: [],
                    textAfterItems: [],
                    issuedAt: null
                }));

                expect(await findEntryOf(books, PostingSourceType.INVOICE, draft.id)).toBeUndefined();
                await inTenant(books.tenantId, async () => await invoices().updateById(draft.id, { issuedAt: new Date() }));

                expect(await describeEntryOf(books, PostingSourceType.INVOICE, draft.id)).toEqual([
                    ['receivables', 'debit', '119.00'],
                    ['revenue19', 'credit', '100.00'],
                    ['outputTax19', 'credit', '19.00']
                ]);
                // a further change of the invoice, which issues nothing, posts nothing
                await inTenant(books.tenantId, async () => await invoices().updateById(draft.id, { textAfterItems: ['Thank you'] }));
                expect(await inTenant(books.tenantId, async () => await entries().count())).toBe(1);
            });

            it('posts a source once: posted again, it answers the entry that stands, and refuses one that changed '
                + 'or is reversed', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(100)]);
                const posted: JournalEntry | undefined = await inTenant(
                    books.tenantId,
                    async () => await postings().findEntryOf(PostingSourceType.INVOICE, invoice.id)
                );
                const postAgain: (of: Invoice) => Promise<JournalEntryDetails | undefined> = async of => await inTenant(
                    books.tenantId,
                    async () => await postings().postFor({ type: PostingSourceType.INVOICE, invoice: of })
                );

                expect((await postAgain(invoice))?.entry.id).toBe(posted?.id);
                expect(await inTenant(books.tenantId, async () => await entries().count())).toBe(1);
                const changed: Promise<JournalEntryDetails | undefined> = postAgain({ ...invoice, items: [itemOf(200)] });
                await expect(changed).rejects.toThrow(ConflictError);
                await expect(changed).rejects.toThrow(
                    `The source invoicing.invoice "${invoice.id}" was posted by the entry 1, `
                    + 'which posts other amounts or another day than it does now.'
                );
                await inTenant(
                    books.tenantId,
                    async () => await journal().reverse(posted?.id ?? '', { postingDate: day('2026-03-02'), text: 'Wrong' })
                );
                await expect(postAgain(invoice)).rejects.toThrow(
                    `The source invoicing.invoice "${invoice.id}" was posted by the entry 1, which is reversed, `
                    + 'and a source is posted once.'
                );
            });

            it('posts nothing of an invoice whose transaction is rolled back', async () => {
                const books: PostingBooks = await createPostingBooks();

                const transaction: Transaction = await entries().dataSource.startTransaction();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(100)], INVOICE_DAY, transaction);
                await transaction.rollback();

                expect(await findEntryOf(books, PostingSourceType.INVOICE, invoice.id)).toBeUndefined();
                expect(await inTenant(books.tenantId, async () => await entries().count())).toBe(0);
                const fiscalYear: FiscalYear = await inTenant(books.tenantId, async () => await inject<Repository<FiscalYear>>(
                    repositoryTokenFor(FiscalYear)
                ).findById(books.fiscalYear.id));
                expect(fiscalYear.lastSequence).toBe(0);
            });

            it('posts nothing of an invoice whose write without a transaction fails after it was posted', async () => {
                const books: PostingBooks = await createPostingBooks();
                await issueInvoice(books, FIRST_NUMBER, [itemOf(100)]);

                // posted before the insert, which the unique number then refuses
                await expect(issueInvoice(books, FIRST_NUMBER, [itemOf(200)])).rejects.toThrow();

                expect(await inTenant(books.tenantId, async () => await entries().count())).toBe(1);
                const fiscalYear: FiscalYear = await inTenant(books.tenantId, async () => await inject<Repository<FiscalYear>>(
                    repositoryTokenFor(FiscalYear)
                ).findById(books.fiscalYear.id));
                expect(fiscalYear.lastSequence).toBe(1);
            });

            it('starts a transaction for a write issuing an invoice without one, and for no other', async () => {
                const books: PostingBooks = await createPostingBooks();
                const started: jest.SpiedFunction<(options?: StartTransactionOptions) => Transaction | Promise<Transaction>> = jest.spyOn(
                    invoices().dataSource,
                    'startTransaction'
                );
                try {
                    const draft: Invoice = await inTenant(books.tenantId, async () => await invoices().create({
                        number: 'TEMP-2026-SIEMEN-0001',
                        currency: 'EUR',
                        items: [itemOf(100)],
                        date: new Date(DRAFT_DATE),
                        performanceDate: new Date(DRAFT_DATE),
                        dueDate: new Date('2026-04-15T12:00:00.000Z'),
                        customerAddressData: siemens,
                        textBeforeItems: [],
                        textAfterItems: [],
                        issuedAt: null
                    }));
                    await inTenant(books.tenantId, async () => await invoices().updateById(draft.id, { textAfterItems: ['Thank you'] }));
                    expect(started).not.toHaveBeenCalled();

                    await inTenant(books.tenantId, async () => await invoices().updateById(draft.id, { issuedAt: new Date() }));
                    expect(started).toHaveBeenCalledTimes(1);

                    // a write with a transaction runs in it
                    const transaction: Transaction = await entries().dataSource.startTransaction();
                    started.mockClear();
                    await issueInvoice(books, SECOND_NUMBER, [itemOf(100)], INVOICE_DAY, transaction);
                    expect(started).not.toHaveBeenCalled();
                    await transaction.commit();
                }
                finally {
                    started.mockRestore();
                }
                expect(await inTenant(books.tenantId, async () => await entries().count())).toBe(2);
            });

            it('refuses to issue an invoice the rules cannot post, and stores nothing', async () => {
                const books: PostingBooks = await createPostingBooks();

                const issuing: Promise<Invoice> = issueInvoice(books, FIRST_NUMBER, [itemOf(100, 16)]);

                await expect(issuing).rejects.toThrow(ConflictError);
                await expect(issuing).rejects
                    .toThrow('The posting rules valid on 2026-03-01 need to name a revenue account for the VAT S 16 %.');
                expect(await inTenant(books.tenantId, async () => await invoices().count())).toBe(0);
                await expect(issueInvoice(books, SECOND_NUMBER, [itemOf(100)], '2027-02-01'))
                    .rejects.toThrow('The posting date 2027-02-01 needs to fall into a fiscal year, and none covers it.');
            });

            it('posts nothing in a tenant without bookkeeping settings', async () => {
                const tenantId: string = UUIDUtilities.generate();

                const invoice: Invoice = await inTenant(tenantId, async () => await invoices().create({
                    number: FIRST_NUMBER,
                    currency: 'EUR',
                    items: [itemOf(100)],
                    date: new Date('2026-03-01T12:00:00.000Z'),
                    performanceDate: new Date('2026-03-01T12:00:00.000Z'),
                    dueDate: new Date('2026-03-15T12:00:00.000Z'),
                    customerAddressData: siemens,
                    textBeforeItems: [],
                    textAfterItems: [],
                    issuedAt: new Date()
                }));

                expect(invoice.issuedAt).toBeInstanceOf(Date);
                expect(await inTenant(tenantId, async () => await entries().count())).toBe(0);
            });
        });

        describe('issuing a credit note', () => {
            it('posts the exact mirror of the entry of its invoice for a full one, and its own amounts for a partial one', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(500), itemOf(500)]);
                const partly: Invoice = await issueInvoice(books, SECOND_NUMBER, [itemOf(500), itemOf(500)]);
                // the rules change after the invoice was posted, which the mirror of its entry does not follow
                await inTenant(books.tenantId, async () => await postingRules().updateRuleSet(books.ruleSet.id, {
                    ...books.ruleSet.rules,
                    revenueAccounts: [{ categoryCode: 'S', rate: 19, accountId: books.accounts.revenue7.id }]
                }));

                const [full, partial] = await inTenant(books.tenantId, async () => {
                    const cancellations: InvoiceCancellationServiceInterface<Invoice>
                        = inject<InvoiceCancellationServiceInterface<Invoice>>(
                            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
                        );
                    return [await cancellations.cancelInvoice(invoice.id), await cancellations.createCreditNote(partly.id, [itemOf(200)])];
                });

                const invoiceLines: [string, 'debit' | 'credit', string][] = await describeEntryOf(
                    books,
                    PostingSourceType.INVOICE,
                    invoice.id
                );
                expect(await describeEntryOf(books, PostingSourceType.CREDIT_NOTE, full.id))
                    .toEqual(invoiceLines.map(([account, side, amount]) => [account, side === 'debit' ? 'credit' : 'debit', amount]));
                expect(invoiceLines).toEqual([
                    ['receivables', 'debit', '1190.00'],
                    ['revenue19', 'credit', '1000.00'],
                    ['outputTax19', 'credit', '190.00']
                ]);
                const creditNoteEntry: JournalEntryDetails | undefined = await findEntryOf(books, PostingSourceType.CREDIT_NOTE, full.id);
                expect(creditNoteEntry?.entry).toMatchObject({
                    sourceType: 'invoicing.credit-note',
                    sourceId: full.id,
                    reversesEntryId: null,
                    documentReference: full.number
                });
                expect(await describeEntryOf(books, PostingSourceType.CREDIT_NOTE, partial.id)).toEqual([
                    ['receivables', 'credit', '238.00'],
                    ['revenue7', 'debit', '200.00'],
                    ['outputTax19', 'debit', '38.00']
                ]);
            });
        });

        describe('recording an expense', () => {
            it('posts the expense and its input tax against the payables', async () => {
                const books: PostingBooks = await createPostingBooks();
                const draft: Expense = await inTenant(books.tenantId, async () => await expenses().createExpense(rentOf(books)));

                const recorded: Expense = await inTenant(books.tenantId, async () => await expenses().recordExpense(draft.id));

                expect(recorded.recordedAt).toBeInstanceOf(Date);
                expect(await describeEntryOf(books, PostingSourceType.EXPENSE, draft.id)).toEqual([
                    ['rent', 'debit', '100.00'],
                    ['inputTax19', 'debit', '19.00'],
                    ['payables', 'credit', '119.00']
                ]);
                expect((await findEntryOf(books, PostingSourceType.EXPENSE, draft.id))?.entry).toMatchObject({
                    id: recorded.postedEntryId,
                    documentDate: day('2026-03-05'),
                    documentReference: 'R-77',
                    text: 'Expense R-77 of Office Supplies GmbH'
                });
                await expect(inTenant(books.tenantId, async () => await expenses().recordExpense(draft.id)))
                    .rejects.toThrow('The expense R-77 is recorded already.');
            });

            it('posts an expense on a liability account, such as a VAT prepayment', async () => {
                const books: PostingBooks = await createPostingBooks();
                const draft: Expense = await inTenant(books.tenantId, async () => await expenses().createExpense(rentOf(books, {
                    supplier: { name: 'Finanzamt Berlin' },
                    documentNumber: 'USt-VA 2026-02',
                    totals: [{ rate: 0, net: new BigNumber('1500.00'), tax: new BigNumber(0) }],
                    accountId: books.accounts.vatPrepayment.id
                })));

                await inTenant(books.tenantId, async () => await expenses().recordExpense(draft.id));

                expect(await describeEntryOf(books, PostingSourceType.EXPENSE, draft.id)).toEqual([
                    ['vatPrepayment', 'debit', '1500.00'],
                    ['payables', 'credit', '1500.00']
                ]);
            });

            it('keeps a recorded expense unchanged, and corrects it by a new one that reverses its entry', async () => {
                const books: PostingBooks = await createPostingBooks();
                const draft: Expense = await inTenant(books.tenantId, async () => await expenses().createExpense(rentOf(books)));
                const recorded: Expense = await inTenant(books.tenantId, async () => await expenses().recordExpense(draft.id));

                await expect(inTenant(books.tenantId, async () => await expenses().updateExpense(draft.id, rentOf(books))))
                    .rejects.toThrow('The expense R-77 is recorded, and cannot be changed or deleted. A new expense corrects it.');
                await expect(inTenant(
                    books.tenantId,
                    async () => await inject<Repository<Expense>>(repositoryTokenFor(Expense)).deleteById(draft.id)
                )).rejects.toThrow('The expense R-77 is recorded, and cannot be changed or deleted. A new expense corrects it.');
                const correction: Expense = await inTenant(
                    books.tenantId,
                    async () => await expenses().correctExpense(draft.id, rentOf(books, {
                        totals: [{ rate: 19, net: new BigNumber('110.00'), tax: new BigNumber('20.90') }]
                    }))
                );

                expect(correction).toMatchObject({ correctsExpenseId: draft.id, recordedAt: expect.any(Date) });
                const reversal: JournalEntry | undefined = await inTenant(books.tenantId, async () => await entries().findOne({
                    where: { reversesEntryId: recorded.postedEntryId },
                    required: false
                }));
                expect(reversal?.text).toBe('Correction of the expense R-77');
                expect(await describeEntryOf(books, PostingSourceType.EXPENSE, correction.id)).toEqual([
                    ['rent', 'debit', '110.00'],
                    ['inputTax19', 'debit', '20.90'],
                    ['payables', 'credit', '130.90']
                ]);
                await expect(inTenant(books.tenantId, async () => await expenses().correctExpense(draft.id, rentOf(books))))
                    .rejects.toThrow('The expense R-77 is corrected already, and an expense is corrected once.');
            });

            it('finds the expenses by their document number or the name of their supplier, whatever its case', async () => {
                const books: PostingBooks = await createPostingBooks();
                const find: (search: string | undefined) => Promise<string[]> = async search => (await inTenant(
                    books.tenantId,
                    async () => await expenses().findExpenses(1, 10, { search })
                )).items.map(e => e.documentNumber);
                await inTenant(books.tenantId, async () => {
                    await expenses().createExpense(rentOf(books));
                    await expenses().createExpense(rentOf(books, { documentNumber: '2026_100%', documentDate: day('2026-03-06') }));
                    await expenses().createExpense(rentOf(books, {
                        documentNumber: 'INV-4711',
                        documentDate: day('2026-03-07'),
                        supplier: { name: 'Hosting Inc', address: null, vatId: null }
                    }));
                });

                expect(await find(undefined)).toEqual(['INV-4711', '2026_100%', 'R-77']);
                expect(await find('r-77')).toEqual(['R-77']);
                expect(await find('office supplies')).toEqual(['2026_100%', 'R-77']);
                expect(await find(' hosting ')).toEqual(['INV-4711']);
                // the _ and % of the search are the characters, not any text
                expect(await find('_1')).toEqual(['2026_100%']);
                expect(await find('0%')).toEqual(['2026_100%']);
                expect(await inTenant(UUIDUtilities.generate(), async () => await expenses().findExpenses(1, 10, { search: 'r-77' })))
                    .toEqual({ items: [], totalAmount: 0 });
            });
        });

        describe('the posting rules', () => {
            it('refuse a rule set naming an account that does not exist or that another tenant has', async () => {
                const books: PostingBooks = await createPostingBooks();
                const other: PostingBooks = await createPostingBooks();
                const unknown: string = UUIDUtilities.generate();

                const naming: (accountId: string) => Promise<PostingRuleSet> = async accountId => await inTenant(
                    books.tenantId,
                    async () => await postingRules().createRuleSet({
                        fiscalYearId: books.fiscalYear.id,
                        validFrom: day(JULY_FIRST),
                        rules: { ...rulesOf(books.accounts, books.bankAccount.id), payablesAccountId: accountId }
                    })
                );

                await expect(naming(unknown)).rejects.toThrow(ConflictError);
                await expect(naming(unknown)).rejects
                    .toThrow(`The posting rules need to name accounts of the books, and "${unknown}" is none.`);
                await expect(naming(other.accounts.payables.id))
                    .rejects.toThrow(`The posting rules need to name accounts of the books, and "${other.accounts.payables.id}" is none.`);
                await expect(inTenant(books.tenantId, async () => await postingRules().updateRuleSet(books.ruleSet.id, {
                    ...books.ruleSet.rules,
                    receivablesAccountId: unknown
                }))).rejects.toThrow(`The posting rules need to name accounts of the books, and "${unknown}" is none.`);
                await expect(inTenant(books.tenantId, async () => await postingRules().createRuleSet({
                    fiscalYearId: books.fiscalYear.id,
                    validFrom: day('2027-01-01'),
                    rules: books.ruleSet.rules
                }))).rejects.toThrow('The posting rules need to be valid from a day of the fiscal year from 2026-01-01 to 2026-12-31.');
            });

            it('post by the rule set valid on the day of a document, such as once the VAT exemption ends within the year', async () => {
                const books: PostingBooks = await createPostingBooks((accounts, bankAccountId) => ({
                    ...rulesOf(accounts, bankAccountId),
                    revenueAccounts: [{ categoryCode: 'E', rate: 0, accountId: accounts.revenueExempt.id }],
                    outputTaxAccounts: []
                }));
                await inTenant(books.tenantId, async () => await postingRules().createRuleSet({
                    fiscalYearId: books.fiscalYear.id,
                    validFrom: day(JULY_FIRST),
                    rules: rulesOf(books.accounts, books.bankAccount.id)
                }));

                const exempt: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(1000, 0, 'E')], '2026-06-30');
                const taxed: Invoice = await issueInvoice(books, SECOND_NUMBER, [itemOf(1000)], JULY_FIRST);

                expect(await describeEntryOf(books, PostingSourceType.INVOICE, exempt.id)).toEqual([
                    ['receivables', 'debit', '1000.00'],
                    ['revenueExempt', 'credit', '1000.00']
                ]);
                expect(await describeEntryOf(books, PostingSourceType.INVOICE, taxed.id)).toEqual([
                    ['receivables', 'debit', '1190.00'],
                    ['revenue19', 'credit', '1000.00'],
                    ['outputTax19', 'credit', '190.00']
                ]);
                await expect(issueInvoice(books, '2026-SIEMEN-0003', [itemOf(1000)], '2026-06-15'))
                    .rejects.toThrow('The posting rules valid on 2026-06-15 need to name a revenue account for the VAT S 19 %.');
            });

            it('are copied into the next fiscal year, as they are valid at the end of the year before', async () => {
                const books: PostingBooks = await createPostingBooks();
                const july: PostingRules = { ...rulesOf(books.accounts, books.bankAccount.id), inputTaxAccounts: [] };
                await inTenant(books.tenantId, async () => await postingRules().createRuleSet({
                    fiscalYearId: books.fiscalYear.id,
                    validFrom: day(JULY_FIRST),
                    rules: july
                }));

                const next: FiscalYear = await inTenant(books.tenantId, async () => await journal().createFiscalYear({}));

                const copied: PostingRuleSet[] = await inTenant(books.tenantId, async () => await postingRules().findRuleSets(next.id));
                expect(copied).toHaveLength(1);
                expect(copied[0]).toMatchObject({ fiscalYearId: next.id, validFrom: day('2027-01-01'), rules: july });
                const invoice: Invoice = await issueInvoice(books, '2027-SIEMEN-0001', [itemOf(100)], '2027-01-05');
                expect((await findEntryOf(books, PostingSourceType.INVOICE, invoice.id))?.entry.fiscalYearId).toBe(next.id);
            });
        });

        describe('matching a bank transaction', () => {
            it('posts a payment of an invoice from the receivables to the bank, and its reversal with the reversal '
                + 'of the match', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(1000)]);
                const payment: BankTransaction = await createTransaction(books, '1190', {
                    counterpartyName: COUNTERPARTY_NAME,
                    counterpartyIban: 'DE02100500000054540402',
                    remittanceInformation: `Invoice ${FIRST_NUMBER}`
                });

                const [suggestion] = await suggest(books, payment);

                expect(suggestion?.request.status).toBe(ApprovalRequestStatus.APPROVED);
                const [match] = await inTenant(
                    books.tenantId,
                    async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch))
                        .findAll({ where: { targetId: invoice.id } })
                );
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match?.id ?? '')).toEqual([
                    ['bank', 'debit', '1190.00'],
                    ['receivables', 'credit', '1190.00']
                ]);
                expect((await findEntryOf(books, PostingSourceType.BANK_MATCH, match?.id ?? ''))?.entry).toMatchObject({
                    postingDate: day('2026-03-20'),
                    text: 'Payment of the invoice 2026-SIEMEN-0001'
                });

                const reversal: BankMatch = await inTenant(
                    books.tenantId,
                    async () => await bankMatches().reverseMatch(match?.id ?? '', 'ada')
                );

                const reversed: JournalEntryDetails | undefined = await findEntryOf(books, PostingSourceType.BANK_MATCH, reversal.id);
                expect(reversed?.entry.reversesEntryId)
                    .toBe((await findEntryOf(books, PostingSourceType.BANK_MATCH, match?.id ?? ''))?.entry.id);
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, reversal.id)).toEqual([
                    ['bank', 'credit', '1190.00'],
                    ['receivables', 'debit', '1190.00']
                ]);
                expect(await findPaymentState(books, invoice)).toEqual(['OPEN', '0.00', '1190.00']);
            });

            it('counts an invoice paid 0.01 € short as paid, within the tolerance, and posts the difference', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(1000)]);
                const payment: BankTransaction = await createTransaction(books, '1189.99', {
                    counterpartyName: COUNTERPARTY_NAME,
                    counterpartyIban: null,
                    remittanceInformation: `Invoice ${FIRST_NUMBER}`
                });
                const request: ApprovalRequest = single(await suggest(books, payment));
                expect(request.status).toBe(ApprovalRequestStatus.PENDING);

                const match: BankMatch = await confirm(books, request, payment, BankMatchTargetType.INVOICE, invoice.id, '1189.99');

                expect(match.difference?.toFixed(2)).toBe('0.01');
                expect(await findPaymentState(books, invoice)).toEqual(['PAID', '1190.00', '0.00']);
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match.id)).toEqual([
                    ['bank', 'debit', '1189.99'],
                    ['difference19', 'debit', '0.01'],
                    ['receivables', 'credit', '1190.00']
                ]);
            });

            it('splits a difference within the tolerance by the tax groups of the invoice, which corrects its VAT', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(100), itemOf(100, 7)]);
                const payment: BankTransaction = await createTransaction(books, '221', {
                    counterpartyName: COUNTERPARTY_NAME,
                    counterpartyIban: null,
                    remittanceInformation: `Invoice ${FIRST_NUMBER}`
                });
                const request: ApprovalRequest = single(await suggest(books, payment));

                const match: BankMatch = await confirm(books, request, payment, BankMatchTargetType.INVOICE, invoice.id, '221');

                // 5.00 short of 226.00: 2.63 of the 119.00 at 19 %, of which 0.42 VAT, and 2.37 of the 107.00 at 7 %, of
                // which 0.16 VAT
                expect(match.difference?.toFixed(2)).toBe('5.00');
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match.id)).toEqual([
                    ['bank', 'debit', '221.00'],
                    ['difference19', 'debit', '2.21'],
                    ['outputTax19', 'debit', '0.42'],
                    ['difference7', 'debit', '2.21'],
                    ['outputTax7', 'debit', '0.16'],
                    ['receivables', 'credit', '226.00']
                ]);
                expect(await findPaymentState(books, invoice)).toEqual(['PAID', '226.00', '0.00']);
            });

            it('leaves an invoice open by what a payment above the tolerance short leaves', async () => {
                const books: PostingBooks = await createPostingBooks();
                const invoice: Invoice = await issueInvoice(books, FIRST_NUMBER, [itemOf(1000)]);
                const payment: BankTransaction = await createTransaction(books, '1180', {
                    counterpartyName: COUNTERPARTY_NAME,
                    counterpartyIban: null,
                    remittanceInformation: `Invoice ${FIRST_NUMBER}`
                });
                const request: ApprovalRequest = single(await suggest(books, payment));

                const match: BankMatch = await confirm(books, request, payment, BankMatchTargetType.INVOICE, invoice.id, '1180');

                expect(match.difference).toBeNull();
                expect(await findPaymentState(books, invoice)).toEqual(['PARTLY_PAID', '1180.00', '10.00']);
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match.id)).toEqual([
                    ['bank', 'debit', '1180.00'],
                    ['receivables', 'credit', '1180.00']
                ]);
            });

            it('suggests the expense money paid pays, and posts the payment from the payables to the bank', async () => {
                const books: PostingBooks = await createPostingBooks();
                const expense: Expense = await inTenant(books.tenantId, async () => {
                    const draft: Expense = await expenses().createExpense(rentOf(books));
                    return await expenses().recordExpense(draft.id);
                });
                const payment: BankTransaction = await createTransaction(books, '-119', {
                    counterpartyName: 'OFFICE SUPPLIES GMBH',
                    counterpartyIban: 'DE02100500000054540402',
                    remittanceInformation: 'R-77'
                });

                const [suggestion] = await suggest(books, payment);

                expect(suggestion?.request).toMatchObject({
                    status: ApprovalRequestStatus.APPROVED,
                    summary: 'Match €119.00 of OFFICE SUPPLIES GMBH on 03/20/2026 with the expense R-77 of Office Supplies GmbH.'
                });
                const [match] = await inTenant(
                    books.tenantId,
                    async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch))
                        .findAll({ where: { targetType: BankMatchTargetType.EXPENSE, targetId: expense.id } })
                );
                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match?.id ?? '')).toEqual([
                    ['payables', 'debit', '119.00'],
                    ['bank', 'credit', '119.00']
                ]);
                expect(await suggest(books, payment)).toEqual([]);
            });

            it('suggests the account of a rule, which waits for a person whatever its confidence, '
                + 'and posts it once confirmed', async () => {
                const books: PostingBooks = await createPostingBooks();
                await inTenant(books.tenantId, async () => await inject<
                    Repository<AccountMatchRule, Omit<AccountMatchRule, 'id' | 'tenantId'>>
                >(
                    repositoryTokenFor(AccountMatchRule)
                ).create({ accountId: books.accounts.capital.id, counterpartyIban: 'DE02120300000000202051', text: 'capital' }));
                const deposit: BankTransaction = await createTransaction(books, '25000', {
                    counterpartyName: 'Ada Lovelace',
                    counterpartyIban: 'DE02 1203 0000 0000 2020 51',
                    remittanceInformation: 'Share capital Acme GmbH'
                });

                const request: ApprovalRequest = single(await suggest(books, deposit));

                // a confidence of 1, which the policy of a confidence of 0.95 leaves to a person all the same
                expect(request).toMatchObject({
                    status: ApprovalRequestStatus.PENDING,
                    summary: 'Match €25,000.00 of Ada Lovelace on 03/20/2026 with the account 2900 Share capital.',
                    input: { targetType: 'ACCOUNT', targetId: books.accounts.capital.id, confidence: 1 }
                });
                expect(await inTenant(
                    books.tenantId,
                    async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch)).count()
                )).toBe(0);

                const match: BankMatch = await confirm(
                    books,
                    request,
                    deposit,
                    BankMatchTargetType.ACCOUNT,
                    books.accounts.capital.id,
                    '25000'
                );

                expect(await describeEntryOf(books, PostingSourceType.BANK_MATCH, match.id)).toEqual([
                    ['bank', 'debit', '25000.00'],
                    ['capital', 'credit', '25000.00']
                ]);
            });
        });
    });
}