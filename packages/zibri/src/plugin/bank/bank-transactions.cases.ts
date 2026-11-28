/* eslint-disable cspell/spellchecker */
import { describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { ChainGap } from '../../data-source/chain/chain-gap.model';
import { type PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FileRecord } from '../../file/file-record.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
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
import { InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../invoicing/models/invoice-recipient-abbreviation.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { NumberInvoices } from '../invoicing/models/number-invoices.model';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount, BankAccountCreateData } from './models/bank-account.model';
import { BankMatchReason } from './models/bank-match-reason.enum';
import { BankMatchTargetType } from './models/bank-match-target-type.enum';
import { BankMatch } from './models/bank-match.model';
import { type BankPluginOptionsInput } from './models/bank-plugin-options-input.model';
import { BANK_STATEMENT_FILE_STORE_NAME } from './models/bank-statement-file-store-name.model';
import { BankStatement } from './models/bank-statement.model';
import { type BankTransactionDetails } from './models/bank-transaction-details.model';
import { type BankTransactionFilter } from './models/bank-transaction-filter.model';
import { BankTransactionState } from './models/bank-transaction-state.model';
import { BankTransactionStatus } from './models/bank-transaction-status.enum';
import { type BankTransactionSuggestion } from './models/bank-transaction-suggestion.model';
import { BankTransaction } from './models/bank-transaction.model';
import { type BankMatchServiceInterface } from './services/bank-match-service.interface';

/**
 * The cases every data source answers the same way about listing the transactions of the bank plugin with what of
 * each is open, and the pending suggestions of a transaction. A file per data source runs them, with
 * {@link bankTransactionsTestEntities}, the {@link BankTransactionsStatementFileStore} and
 * {@link bankTransactionsTestProviders} registered, and the bank, the approval and the invoicing plugin.
 */

/**
 * The folder the original files of the statements of the cases are kept in, which the cases import none of.
 */
export const bankTransactionsStatementsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bank-transactions-statements-${UUIDUtilities.generate()}`);

/**
 * The file store of the bank statements, which the bank plugin needs.
 */
@FileStore()
export class BankTransactionsStatementFileStore extends FsFileStore {
    constructor() {
        super(BANK_STATEMENT_FILE_STORE_NAME, bankTransactionsStatementsFolder);
    }
}

/**
 * The entities the cases need, besides those of a test server.
 */
export const bankTransactionsTestEntities: Newable<BaseEntity>[] = [
    FileRecord,
    ChainGap,
    BankAccount,
    BankStatement,
    BankTransaction,
    BankTransactionState,
    BankMatch,
    ApprovalRequest,
    ApprovalDecision,
    Invoice,
    NumberInvoices,
    InvoiceRecipientAbbreviation
];

/**
 * The providers of the cases: the bank plugin matches with a tolerance of 5 and approves nothing on its own, and every
 * tenant issues its invoices as one company.
 */
export const bankTransactionsTestProviders: DiProvider<unknown>[] = [
    defineProvider<BankPluginOptionsInput>({
        token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { matching: { paymentDifferenceTolerance: 5 } }
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
 * A tenant of its own with two bank accounts.
 */
type TestBank = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    tenantId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    account: BankAccount,
    /**
     * A second account, such as a savings account.
     */
    savings: BankAccount
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

async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

function bankMatches(): BankMatchServiceInterface {
    return inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE);
}

async function createBank(): Promise<TestBank> {
    const tenantId: string = UUIDUtilities.generate();
    return await inTenant(tenantId, async () => {
        const accounts: Repository<BankAccount, BankAccountCreateData> = inject(repositoryTokenFor(BankAccount));
        return {
            tenantId,
            account: await accounts.create({ iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' }),
            savings: await accounts.create({ iban: 'DE02100500000054540402', name: 'Savings account', currency: 'EUR' })
        };
    });
}

/**
 * Creates an issued invoice of one item of 1000.00 at 19 %, of 1190.00.
 * @param bank - The tenant.
 * @param number - The number of the invoice.
 * @returns The invoice.
 */
async function issueInvoice(bank: TestBank, number: string): Promise<Invoice> {
    return await inTenant(bank.tenantId, async () => await inject<Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>>(
        repositoryTokenFor(Invoice)
    ).create({
        number,
        currency: 'EUR',
        items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 1000 }],
        date: new Date('2026-03-01T12:00:00.000Z'),
        performanceDate: new Date('2026-03-01T12:00:00.000Z'),
        dueDate: new Date('2026-03-15T12:00:00.000Z'),
        customerAddressData: siemens,
        textBeforeItems: [],
        textAfterItems: [],
        issuedAt: new Date()
    }));
}

/**
 * Creates a transaction.
 * @param bank - The tenant.
 * @param amount - The amount, negative for money paid.
 * @param bookingDate - When it was booked, such as `2026-03-20T09:30:00.000Z`.
 * @param remittanceInformation - What the payer gave.
 * @param account - The account it was booked on, the business account by default.
 * @returns The transaction.
 */
async function createTransaction(
    bank: TestBank,
    amount: string,
    bookingDate: string,
    remittanceInformation: string | null = null,
    account: BankAccount = bank.account
): Promise<BankTransaction> {
    return await inTenant(bank.tenantId, async () => await inject<Repository<BankTransaction, OmitStrict<BankTransaction, 'id' | 'tenantId'>>>(
        repositoryTokenFor(BankTransaction)
    ).create({
        accountId: account.id,
        statementId: UUIDUtilities.generate(),
        bookingDate: new Date(bookingDate),
        valueDate: null,
        amount: new BigNumber(amount),
        currency: 'EUR',
        counterpartyName: 'SIEMENS AG',
        counterpartyIban: null,
        remittanceInformation,
        endToEndId: null,
        mandateId: null,
        creditorId: null,
        bankReference: null,
        deduplicationKey: UUIDUtilities.generate()
    }));
}

/**
 * Suggests the matches of a transaction, which wait for a person, as the cases approve nothing on their own.
 * @param bank - The tenant.
 * @param transaction - The transaction.
 * @returns The requests proposed.
 */
async function suggest(bank: TestBank, transaction: BankTransaction): Promise<ApprovalRequestDetails[]> {
    return await inTenant(bank.tenantId, async () => await bankMatches().suggestMatches([transaction.id]));
}

/**
 * Matches a part of a transaction with an invoice as a person does once they approve a request of it: the action runs
 * in a transaction. The request is the one the transaction was suggested with, which stays pending.
 * @param bank - The tenant.
 * @param transaction - The transaction.
 * @param invoice - The invoice.
 * @param amount - The amount.
 * @returns The match.
 */
async function confirm(bank: TestBank, transaction: BankTransaction, invoice: Invoice, amount: string): Promise<BankMatch> {
    const [suggestion] = await suggest(bank, transaction);
    if (suggestion?.request.status !== ApprovalRequestStatus.PENDING) {
        throw new Error(`No pending suggestion of ${transaction.amount.toFixed()}.`);
    }
    return await inTenant(bank.tenantId, async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch)).dataSource.runInTransaction(
        async started => await bankMatches().createMatch(
            { transactionId: transaction.id, targetType: BankMatchTargetType.INVOICE, targetId: invoice.id, amount: new BigNumber(amount) },
            { transaction: started, request: suggestion.request, decidedBy: 'ada', decidedByKind: ApprovalActorKind.USER }
        ),
        { maxAttempts: 1 }
    ));
}

async function findDetails(bank: TestBank, filter: BankTransactionFilter, page: number = 1, limit: number = 10): Promise<PaginationResult<BankTransactionDetails>> {
    return await inTenant(bank.tenantId, async () => await bankMatches().findTransactionDetails(page, limit, filter));
}

/**
 * The state of a transaction, as its status and open amount.
 * @param bank - The tenant.
 * @param transaction - The transaction.
 * @returns The status and the open amount in two decimals, or undefined without a state.
 */
async function findState(bank: TestBank, transaction: BankTransaction): Promise<[string, string] | undefined> {
    const state: BankTransactionState | undefined = await inTenant(bank.tenantId, async () => await inject<Repository<BankTransactionState>>(
        repositoryTokenFor(BankTransactionState)
    ).findOne({ where: { transactionId: transaction.id }, required: false }));
    return state == undefined ? undefined : [state.status, state.openAmount.toFixed(2)];
}

/**
 * Matches a part of a transaction with an invoice in a transaction of its own, as approving a request does.
 * @param bank - The tenant.
 * @param transaction - The transaction.
 * @param invoice - The invoice.
 * @param amount - The amount.
 * @param request - The request it is approved through.
 * @returns The match.
 */
async function match(bank: TestBank, transaction: BankTransaction, invoice: Invoice, amount: string, request: ApprovalRequest): Promise<BankMatch> {
    return await inTenant(bank.tenantId, async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch)).dataSource.runInTransaction(
        async started => await bankMatches().createMatch(
            { transactionId: transaction.id, targetType: BankMatchTargetType.INVOICE, targetId: invoice.id, amount: new BigNumber(amount) },
            { transaction: started, request, decidedBy: 'ada', decidedByKind: ApprovalActorKind.USER }
        ),
        { maxAttempts: 1 }
    ));
}

/**
 * The request a transaction is suggested for an invoice with, which stays pending.
 * @param bank - The tenant.
 * @param transaction - The transaction.
 * @returns The request.
 */
async function suggestedRequest(bank: TestBank, transaction: BankTransaction): Promise<ApprovalRequest> {
    const [suggestion] = await suggest(bank, transaction);
    if (suggestion == undefined) {
        throw new Error(`No suggestion of ${transaction.amount.toFixed()}.`);
    }
    return suggestion.request;
}

/**
 * A page of transactions, as the amount and the open amount of each.
 * @param page - The page.
 * @returns A row per transaction, in the order of the page.
 */
function describePage(page: PaginationResult<BankTransactionDetails>): [string, string][] {
    return page.items.map(d => [d.transaction.amount.toFixed(2), d.openAmount.toFixed(2)]);
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeBankTransactions(dataSourceName: string): void {
    describe(`the transactions of the bank on ${dataSourceName}`, () => {
        it('answers each transaction of a page with what of it is open, which a reversal opens again', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice 2026-SIEMEN-0001');
            await createTransaction(bank, '500', '2026-03-19T00:00:00.000Z');
            await createTransaction(bank, '-20', '2026-03-18T00:00:00.000Z');
            const match: BankMatch = await confirm(bank, payment, invoice, '1190');

            const page: PaginationResult<BankTransactionDetails> = await findDetails(bank, {});

            expect(page.totalAmount).toBe(3);
            // the latest booking first, money paid open without its sign
            expect(describePage(page)).toEqual([['1190.00', '0.00'], ['500.00', '500.00'], ['-20.00', '20.00']]);

            await inTenant(bank.tenantId, async () => await bankMatches().reverseMatch(match.id, 'ada'));

            expect(describePage(await findDetails(bank, {}))).toEqual([['1190.00', '1190.00'], ['500.00', '500.00'], ['-20.00', '20.00']]);
        });

        it('narrows to the open or the matched transactions, counting every one of them, and pages them', async () => {
            const bank: TestBank = await createBank();
            for (const [number, day] of [['2026-SIEMEN-0001', '05'], ['2026-SIEMEN-0002', '06'], ['2026-SIEMEN-0003', '07']] as const) {
                const invoice: Invoice = await issueInvoice(bank, number);
                const payment: BankTransaction = await createTransaction(bank, '1190', `2026-03-${day}T10:00:00.000Z`, `Invoice ${number}`);
                await confirm(bank, payment, invoice, '1190');
            }
            const partly: Invoice = await issueInvoice(bank, '2026-SIEMEN-0004');
            const part: BankTransaction = await createTransaction(bank, '1190', '2026-03-08T10:00:00.000Z', 'Invoice 2026-SIEMEN-0004');
            await confirm(bank, part, partly, '1000');
            await createTransaction(bank, '75', '2026-03-09T10:00:00.000Z');
            await createTransaction(bank, '-30', '2026-04-01T10:00:00.000Z', null, bank.savings);

            const open: PaginationResult<BankTransactionDetails> = await findDetails(bank, { status: BankTransactionStatus.OPEN });
            const matched: PaginationResult<BankTransactionDetails> = await findDetails(bank, { status: BankTransactionStatus.MATCHED });

            expect([open.totalAmount, describePage(open)]).toEqual([3, [['-30.00', '30.00'], ['75.00', '75.00'], ['1190.00', '190.00']]]);
            expect(matched.totalAmount).toBe(3);
            expect(matched.items.map(d => d.transaction.bookingDate.toISOString().slice(0, 10))).toEqual(['2026-03-07', '2026-03-06', '2026-03-05']);
            // the second page of two, and the count of all of them
            const second: PaginationResult<BankTransactionDetails> = await findDetails(bank, { status: BankTransactionStatus.MATCHED }, 2, 2);
            expect([second.totalAmount, second.items.map(d => d.transaction.bookingDate.toISOString().slice(0, 10))]).toEqual([3, ['2026-03-05']]);
            // with the account and the days, a booking at 10:00 counting for its day
            const ofAccount: PaginationResult<BankTransactionDetails> = await findDetails(bank, {
                accountId: bank.account.id,
                from: new Date('2026-03-06T00:00:00.000Z'),
                until: new Date('2026-03-08T00:00:00.000Z'),
                status: BankTransactionStatus.OPEN
            });
            expect([ofAccount.totalAmount, describePage(ofAccount)]).toEqual([1, [['1190.00', '190.00']]]);
            expect((await findDetails(bank, { accountId: bank.savings.id, status: BankTransactionStatus.MATCHED })).totalAmount).toBe(0);
        });

        it('creates the state of each transaction imported, open by its whole amount', async () => {
            const bank: TestBank = await createBank();
            const sample: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, '__testing__', 'camt053-001-08.sample.xml'));

            await inTenant(bank.tenantId, async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE)
                .importStatements({ name: 'statement.xml', data: Buffer.from(sample) }));

            const states: BankTransactionState[] = await inTenant(bank.tenantId, async () => await inject<Repository<BankTransactionState>>(
                repositoryTokenFor(BankTransactionState)
            ).findAll({ order: { openAmount: 'ASC' }, limit: 'all' }));
            expect(states.map(s => [s.status, s.openAmount.toFixed(2), s.accountId])).toEqual([
                [BankTransactionStatus.OPEN, '49.99', bank.account.id],
                [BankTransactionStatus.OPEN, '250.00', bank.account.id]
            ]);
            const page: PaginationResult<BankTransactionDetails> = await findDetails(bank, { status: BankTransactionStatus.OPEN });
            expect(page.items.map(d => d.transaction.id).sort()).toEqual(states.map(s => s.transactionId).sort());
        });

        it('writes the state with each match and its reversal: open, partly matched, matched in full, and open again', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice 2026-SIEMEN-0001');
            const request: ApprovalRequest = await suggestedRequest(bank, payment);
            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.OPEN, '1190.00']);

            await match(bank, payment, invoice, '1000', request);
            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.OPEN, '190.00']);
            const rest: BankMatch = await match(bank, payment, invoice, '190', request);
            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.MATCHED, '0.00']);
            await inTenant(bank.tenantId, async () => await bankMatches().reverseMatch(rest.id, 'ada'));

            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.OPEN, '190.00']);
            expect(describePage(await findDetails(bank, { status: BankTransactionStatus.OPEN }))).toEqual([['1190.00', '190.00']]);
        });

        it('keeps the state of a transaction matched by several at once as its matches add up', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice 2026-SIEMEN-0001');
            const request: ApprovalRequest = await suggestedRequest(bank, payment);

            // three of 500 at once, of which the third is more than is left of the transaction
            const settled: PromiseSettledResult<BankMatch>[] = await Promise.allSettled(
                [1, 2, 3].map(async () => await match(bank, payment, invoice, '500', request))
            );

            expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(2);
            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.OPEN, '190.00']);
            expect(await inTenant(bank.tenantId, async () => await bankMatches().recomputeTransactionStates([payment.id]))).toEqual([]);
        });

        it('leaves the state as it was when the transaction a match is written in rolls back', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice 2026-SIEMEN-0001');
            const request: ApprovalRequest = await suggestedRequest(bank, payment);

            await expect(inTenant(bank.tenantId, async () => await inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch)).dataSource.runInTransaction(
                async started => {
                    await bankMatches().createMatch(
                        { transactionId: payment.id, targetType: BankMatchTargetType.INVOICE, targetId: invoice.id, amount: new BigNumber('1190') },
                        { transaction: started, request, decidedBy: 'ada', decidedByKind: ApprovalActorKind.USER }
                    );
                    throw new Error('The approval failed after the match.');
                },
                { maxAttempts: 1 }
            ))).rejects.toThrow('The approval failed after the match.');

            expect(await findState(bank, payment)).toEqual([BankTransactionStatus.OPEN, '1190.00']);
        });

        it('recomputes a state that does not hold from the matches, and creates one that is missing', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice 2026-SIEMEN-0001');
            const other: BankTransaction = await createTransaction(bank, '75', '2026-03-21T09:30:00.000Z');
            await match(bank, payment, invoice, '1000', await suggestedRequest(bank, payment));
            const states: Repository<BankTransactionState> = inject(repositoryTokenFor(BankTransactionState));
            await inTenant(bank.tenantId, async () => {
                // written around the bank plugin
                await states.updateAll({ transactionId: payment.id }, { openAmount: new BigNumber('1190'), status: BankTransactionStatus.OPEN });
                await states.deleteAll({ transactionId: other.id });
            });

            const written: BankTransactionState[] = await inTenant(bank.tenantId, async () => await bankMatches().recomputeTransactionStates());

            expect(written.map(s => [s.transactionId, s.status, s.openAmount.toFixed(2)]).sort()).toEqual([
                [payment.id, BankTransactionStatus.OPEN, '190.00'],
                [other.id, BankTransactionStatus.OPEN, '75.00']
            ].sort());
            expect(await findState(bank, other)).toEqual([BankTransactionStatus.OPEN, '75.00']);
            expect(await inTenant(bank.tenantId, async () => await bankMatches().recomputeTransactionStates())).toEqual([]);
        });

        it('suggests no invoice without an issuedAt, a draft', async () => {
            const bank: TestBank = await createBank();
            const draft: Invoice = await issueInvoice(bank, 'TEMP-2026-SIEMEN-0001');
            await inTenant(bank.tenantId, async () => await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).updateById(draft.id, { issuedAt: null }));
            const payment: BankTransaction = await createTransaction(bank, '1190', '2026-03-20T09:30:00.000Z', 'Invoice TEMP-2026-SIEMEN-0001');

            expect(await suggest(bank, payment)).toEqual([]);
        });

        it('refuses a day with a time, and an until before from', async () => {
            const bank: TestBank = await createBank();

            await expect(findDetails(bank, { from: new Date('2026-03-06T10:00:00.000Z') }))
                .rejects.toThrow('The from needs to be a day without a time, such as 2026-03-31.');
            await expect(findDetails(bank, { from: new Date('2026-03-06T00:00:00.000Z'), until: new Date('2026-03-05T00:00:00.000Z') }))
                .rejects.toThrow('The until needs to be on or after the from, 2026-03-06.');
        });

        it('answers the pending suggestions of a transaction, with the difference each would leave of its invoice', async () => {
            const bank: TestBank = await createBank();
            const invoice: Invoice = await issueInvoice(bank, '2026-SIEMEN-0001');
            const short: BankTransaction = await createTransaction(bank, '1189.99', '2026-03-20T00:00:00.000Z', 'Invoice 2026-SIEMEN-0001');
            const other: Invoice = await issueInvoice(bank, '2026-SIEMEN-0002');
            const part: BankTransaction = await createTransaction(bank, '1000', '2026-03-21T00:00:00.000Z', 'Invoice 2026-SIEMEN-0002');
            const [suggested] = await suggest(bank, short);
            await suggest(bank, part);

            const suggestions: BankTransactionSuggestion[] = await inTenant(bank.tenantId, async () => await bankMatches().findSuggestions(short.id));

            expect(suggestions).toHaveLength(1);
            expect(suggestions[0]).toMatchObject({
                requestId: suggested?.request.id,
                targetType: BankMatchTargetType.INVOICE,
                targetId: invoice.id,
                confidence: 0.75,
                reasons: [BankMatchReason.INVOICE_NUMBER, BankMatchReason.COUNTERPARTY_NAME],
                summary: 'Match €1,189.99 paid by SIEMENS AG on 03/20/2026 with the invoice 2026-SIEMEN-0001.'
            });
            expect([suggestions[0]?.amount.toFixed(2), suggestions[0]?.paymentDifference?.toFixed(2)]).toEqual(['1189.99', '0.01']);
            // 190.00 short of the other is more than the tolerance, and stays open
            const [ofPart] = await inTenant(bank.tenantId, async () => await bankMatches().findSuggestions(part.id));
            expect([ofPart?.targetId, ofPart?.paymentDifference]).toEqual([other.id, null]);
        });

        it('answers no suggestion of a transaction that has none, and finds no transaction of another tenant', async () => {
            const bank: TestBank = await createBank();
            const lonely: BankTransaction = await createTransaction(bank, '75', '2026-03-09T10:00:00.000Z');
            const stranger: TestBank = await createBank();

            expect(await inTenant(bank.tenantId, async () => await bankMatches().findSuggestions(lonely.id))).toEqual([]);
            await expect(inTenant(stranger.tenantId, async () => await bankMatches().findSuggestions(lonely.id))).rejects.toThrow(lonely.id);
            expect((await findDetails(stranger, {})).totalAmount).toBe(0);
        });
    });
}
