/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
    type ApprovalRequestDetailsModel,
    type ApprovalRequestModel,
    type BankMatchModel,
    type BankTransactionDetailsModel,
    type BankTransactionSuggestionModel,
    type ErrorResponseBody,
    type PaginationResult
} from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { ChainGap } from '../../data-source/chain/chain-gap.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FileRecord } from '../../file/file-record.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ApprovalRequestController } from '../approval/approval-request.controller';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ApprovalActorKind } from '../approval/models/approval-actor-kind.enum';
import { ApprovalDecision } from '../approval/models/approval-decision.model';
import { ApprovalRequestStatus } from '../approval/models/approval-request-status.enum';
import { ApprovalRequest } from '../approval/models/approval-request.model';
import { ZibriApprovalPermissions } from '../approval/models/zibri-approval-permissions.model';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { InvoiceItem } from '../invoicing/models/invoice-item.model';
import { type InvoicePaymentState } from '../invoicing/models/invoice-payment-state.model';
import { InvoiceRecipientAbbreviation } from '../invoicing/models/invoice-recipient-abbreviation.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { NumberInvoices } from '../invoicing/models/number-invoices.model';
import { type InvoiceCancellationServiceInterface } from '../invoicing/services/invoice-cancellation-service.interface';
import { BankMatchApprovalAction } from './bank-match.approval-action';
import { BankController } from './bank.controller';
import { ZibriBankPlugin } from './bank.plugin';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount } from './models/bank-account.model';
import { BankMatchReason } from './models/bank-match-reason.enum';
import { BankMatch } from './models/bank-match.model';
import { BankStatement } from './models/bank-statement.model';
import { BankTransactionState } from './models/bank-transaction-state.model';
import { BankTransaction } from './models/bank-transaction.model';
import { ZibriBankPermissions } from './models/zibri-bank-permissions.model';

// matching the payments of a statement with the invoices of a tenant, as an application does: the statement uploaded,
// the suggestions read and decided through the routes of the approval requests, and the state of an invoice read from
// the invoicing plugin. In memory, as nothing here depends on where the rows are stored

const statementsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bank-matching-statements-${UUIDUtilities.generate()}`);

@FileStore()
class BankStatementFileStore extends FsFileStore {
    constructor() {
        super('bank-statements', statementsFolder);
    }
}

@Controller('/bank', { versions: 'all' })
class AppBankController extends BankController {}

@Controller('/approval-requests', { versions: 'all' })
class AppApprovalRequestController extends ApprovalRequestController {}

const PERMISSIONS: Permission[] = [...Object.values(ZibriBankPermissions), ...Object.values(ZibriApprovalPermissions)];

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

/**
 * The statement: 238.00 paying 2026-SIEMEN-0001, 50.00 and 69.00 paying 2026-SIEMEN-0002 in two parts, 357.00 paying
 * 2026-SMALLS-0001 and 2026-SMALLS-0002 at once, 119.00 of Max Mustermann naming no invoice, and 20.00 paid.
 */
const SAMPLE: string = 'camt053-001-08-payments.sample.xml';

/**
 * The confidence from which the tests approve a suggestion without a person.
 */
const AUTO_APPROVE_CONFIDENCE: number = 0.95;

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

const smallShop: InvoiceAddress = { ...siemens, companyName: 'Small Shop' };

const mustermann: InvoiceAddress = { ...siemens, company: false, companyName: null, formOfAddress: 'Mr', firstName: 'Max', lastName: 'Mustermann' };

/**
 * The invoices the statement pays, by number: the recipient and the net price of one item at 19 %.
 */
const INVOICES: Record<string, { address: InvoiceAddress, items: InvoiceItem[] }> = {
    '2026-SIEMEN-0001': { address: siemens, items: [itemOf(100, 2)] },
    '2026-SIEMEN-0002': { address: siemens, items: [itemOf(50), itemOf(50)] },
    '2026-SMALLS-0001': { address: smallShop, items: [itemOf(200)] },
    '2026-SMALLS-0002': { address: smallShop, items: [itemOf(100)] },
    '2026-MUSTER-0001': { address: mustermann, items: [itemOf(100)] }
};

/**
 * A member of a tenant, with an api key carrying the given permissions.
 */
type Member = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The tenant they are a member of.
     */
    tenantId: string,
    /**
     * The api key they send.
     */
    key: string
};

/**
 * A tenant with a bank account of the statement: a member who may do everything, and a clerk who may only suggest.
 */
type Team = {
    /**
     * The member with every permission.
     */
    admin: Member,
    /**
     * The member with `bank.matches.suggest` alone.
     */
    clerk: Member,
    /**
     * The invoices of the tenant, by number.
     */
    invoices: Map<string, Invoice>
};

/**
 * The input of a request of `bank.match`, as it is answered.
 */
type MatchInput = {
    transactionId: string,
    targetType: string,
    targetId: string,
    amount: string,
    confidence?: number | null,
    reasons?: BankMatchReason[] | null
};

/**
 * A request of `bank.match`, as it is answered.
 */
type MatchRequest = OmitStrict<ApprovalRequestModel, 'input'> & { input: MatchInput };

/**
 * The answer of a route.
 */
type Answer<T> = {
    status: number,
    body: T
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [BankStatementFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [
                    ...defaultTestServerEntities,
                    ApiKey,
                    TestTenant,
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
                ],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [AppBankController, AppApprovalRequestController],
        plugins: [new ZibriBankPlugin(), new ZibriApprovalPlugin(), new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: [] }, roles),
            defineProvider({
                token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                useValue: { matching: { autoApproveConfidence: AUTO_APPROVE_CONFIDENCE, paymentDifferenceTolerance: 0 } }
            }),
            // German beside the default, for a summary written in the locale of the request proposing it
            defineProvider({
                token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                useValue: {
                    supportedLocales: {
                        'en-US': {
                            currencyCode: 'USD',
                            defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
                            defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
                            defaultTimeFormat: defineDateFormat('h:mm A')
                        },
                        'de-DE': {
                            currencyCode: 'EUR',
                            defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
                            defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
                            defaultTimeFormat: defineDateFormat('HH:mm')
                        }
                    }
                }
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
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * An item of one hour of consulting.
 * @param price - Its net price.
 * @param amount - How many hours.
 * @returns The item, at 19 %.
 */
function itemOf(price: number, amount: number = 1): InvoiceItem {
    return { name: 'Consulting', amount, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price };
}

async function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

async function addMember(tenantId: string, permissions: Permission[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [Roles.USER] });
    await runInTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [MemberRoles.ADMIN] }));
    const created: CreatedApiKey = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
        user.id,
        { name: 'bank', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { userId: user.id, tenantId, key: created.key };
}

/**
 * Creates a tenant with the bank account of the statement, its members and the given invoices of `INVOICES`.
 * @param numbers - The numbers of the invoices to issue.
 * @returns The tenant.
 */
async function createTeam(numbers: string[] = Object.keys(INVOICES)): Promise<Team> {
    const tenantId: string = (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
    const admin: Member = await addMember(tenantId, PERMISSIONS);
    const clerk: Member = await addMember(tenantId, [ZibriBankPermissions.BANK_MATCHES_SUGGEST, ZibriBankPermissions.BANK_MATCHES_READ]);
    await runInTenant(tenantId, async () => await inject<Repository<BankAccount>>(repositoryTokenFor(BankAccount))
        .create({ iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' }));
    const invoices: Map<string, Invoice> = new Map();
    for (const number of numbers) {
        invoices.set(number, await issueInvoice(tenantId, number));
    }
    return { admin, clerk, invoices };
}

async function issueInvoice(tenantId: string, number: string): Promise<Invoice> {
    const invoice: { address: InvoiceAddress, items: InvoiceItem[] } | undefined = INVOICES[number];
    if (invoice == undefined) {
        throw new Error(`No invoice ${number}.`);
    }
    return await runInTenant(tenantId, async () => await inject<Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>>(repositoryTokenFor(Invoice)).create({
        number,
        currency: 'EUR',
        items: invoice.items,
        date: new Date(Date.UTC(2026, 10, 1)),
        performanceDate: new Date(Date.UTC(2026, 9, 31)),
        dueDate: new Date(Date.UTC(2026, 10, 15)),
        customerAddressData: invoice.address,
        textBeforeItems: [],
        textAfterItems: [],
        issuedAt: new Date()
    }));
}

function invoiceOf(team: Team, number: string): Invoice {
    const invoice: Invoice | undefined = team.invoices.get(number);
    if (invoice == undefined) {
        throw new Error(`No invoice ${number}.`);
    }
    return invoice;
}

async function call<T>(path: string, caller: Member, init: RequestInit = {}): Promise<Answer<T>> {
    const res: Response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            'x-api-key': caller.key,
            'x-tenant-id': caller.tenantId,
            ...typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}
        }
    });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

async function importStatement(team: Team): Promise<void> {
    const form: FormData = new FormData();
    const data: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, '__testing__', SAMPLE));
    form.append('file', new Blob([data], { type: 'text/xml' }), SAMPLE);
    const imported: Answer<unknown> = await call('/bank/statements', team.admin, { method: 'POST', body: form });
    expect(imported.status).toBe(200);
}

async function findRequests(team: Team, status: ApprovalRequestStatus): Promise<MatchRequest[]> {
    const page: Answer<PaginationResult<MatchRequest>> = await call(`/approval-requests?page=1&limit=100&action=bank.match&status=${status}`, team.admin);
    return page.body.items;
}

/**
 * The matches requests propose, as the number of the invoice, the amount and the confidence, sorted.
 * @param team - The tenant.
 * @param requests - The requests.
 * @returns A row per request.
 */
function describeRequests(team: Team, requests: MatchRequest[]): [string | undefined, string, number | null | undefined][] {
    const numbers: Map<string, string> = new Map([...team.invoices].map(([number, invoice]) => [invoice.id, number]));
    return requests
        .map((r): [string | undefined, string, number | null | undefined] => [numbers.get(r.input.targetId), r.input.amount, r.input.confidence])
        .sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));
}

function findRequest(team: Team, requests: MatchRequest[], number: string, amount: string): MatchRequest {
    const request: MatchRequest | undefined = requests.find(r => r.input.targetId === invoiceOf(team, number).id && r.input.amount === amount);
    if (request == undefined) {
        throw new Error(`No request of ${amount} for ${number}.`);
    }
    return request;
}

async function decide(team: Team, request: { id: string }, decision: 'approve' | 'reject', caller: Member = team.admin): Promise<Answer<ApprovalRequestDetailsModel>> {
    return await call(`/approval-requests/${request.id}/${decision}`, caller, { method: 'POST', body: JSON.stringify({}) });
}

async function findTransactionId(team: Team, amount: string): Promise<string> {
    const page: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('/bank/transactions?page=1&limit=100', team.admin);
    const details: BankTransactionDetailsModel | undefined = page.body.items.find(d => d.transaction.amount === amount);
    if (details == undefined) {
        throw new Error(`No transaction of ${amount}.`);
    }
    return details.transaction.id;
}

/**
 * The payment state of an invoice, as its status, what is paid and what is open.
 * @param team - The tenant.
 * @param number - The number of the invoice.
 * @returns The state, with the amounts in two decimals.
 */
async function findPaymentState(team: Team, number: string): Promise<[string, string, string] | undefined> {
    const state: InvoicePaymentState | undefined = await runInTenant(
        team.admin.tenantId,
        async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE).resolvePaymentState(invoiceOf(team, number))
    );
    return state == undefined ? undefined : [state.status, state.paid.toFixed(2), state.open.toFixed(2)];
}

describe('matching bank transactions with invoices', () => {
    it('suggests the invoice each payment received pays, proposed by the system, and approves those above the confidence', async () => {
        const team: Team = await createTeam();

        await importStatement(team);

        const pending: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.PENDING);
        // the part payments of one invoice, the payment of two, and the one naming no invoice, by its amount and payer
        expect(describeRequests(team, pending)).toEqual([
            ['2026-MUSTER-0001', '119', 0.4],
            ['2026-SIEMEN-0002', '50', 0.75],
            ['2026-SIEMEN-0002', '69', 0.75],
            ['2026-SMALLS-0001', '238', 0.75],
            ['2026-SMALLS-0002', '119', 0.75]
        ]);
        expect(pending.every(r => r.proposedBy === 'bank-matching' && r.proposedByKind === ApprovalActorKind.SYSTEM)).toBe(true);
        const partPayment: MatchRequest = findRequest(team, pending, '2026-SIEMEN-0002', '50');
        expect(partPayment.input.reasons).toEqual([BankMatchReason.INVOICE_NUMBER, BankMatchReason.COUNTERPARTY_NAME]);
        // in the default locale, as the import asks for no other
        expect(partPayment.summary).toBe('Match €50.00 paid by SIEMENS AG on 11/11/2026 with the invoice 2026-SIEMEN-0002.');
        expect(findRequest(team, pending, '2026-MUSTER-0001', '119').input.reasons).toEqual([BankMatchReason.AMOUNT, BankMatchReason.COUNTERPARTY_NAME]);

        // the payment naming the invoice and paying its total, approved by the policy, with the match recorded
        const approved: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.APPROVED);
        expect(describeRequests(team, approved)).toEqual([['2026-SIEMEN-0001', '238', 1]]);
        expect(approved[0]?.input.reasons).toEqual([BankMatchReason.INVOICE_NUMBER, BankMatchReason.AMOUNT, BankMatchReason.COUNTERPARTY_NAME]);
        const matches: Answer<PaginationResult<BankMatchModel>> = await call(
            `/bank/matches?page=1&limit=10&invoiceId=${invoiceOf(team, '2026-SIEMEN-0001').id}`,
            team.admin
        );
        expect(matches.body.items).toHaveLength(1);
        expect(matches.body.items[0]).toMatchObject({
            transactionId: await findTransactionId(team, '238'),
            targetType: 'INVOICE',
            amount: '238',
            currency: 'EUR',
            requestId: approved[0]?.id,
            confirmedBy: `confidence-at-least-${AUTO_APPROVE_CONFIDENCE}`,
            confirmedByKind: ApprovalActorKind.POLICY
        });
        expect(await findPaymentState(team, '2026-SIEMEN-0001')).toEqual(['PAID', '238.00', '0.00']);
        // the money paid, which names an invoice number too, is suggested for nothing
        const paid: string = await findTransactionId(team, '-20');
        expect([...pending, ...approved].some(r => r.input.transactionId === paid)).toBe(false);
    });

    it('lets a person with the permission confirm a suggestion, which leaves the invoice partly paid', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const partPayment: MatchRequest = findRequest(team, await findRequests(team, ApprovalRequestStatus.PENDING), '2026-SIEMEN-0002', '50');

        expect((await decide(team, partPayment, 'approve', team.clerk)).status).toBe(403);
        const approved: Answer<ApprovalRequestDetailsModel> = await decide(team, partPayment, 'approve');

        expect(approved.body.request.status).toBe(ApprovalRequestStatus.APPROVED);
        expect(approved.body.decision).toMatchObject({ decidedBy: team.admin.userId, decidedByKind: ApprovalActorKind.USER });
        expect(approved.body.decision?.result).toMatchObject({ amount: '50', confirmedBy: team.admin.userId, confirmedByKind: ApprovalActorKind.USER });
        expect(await findPaymentState(team, '2026-SIEMEN-0002')).toEqual(['PARTLY_PAID', '50.00', '69.00']);
    });

    it('leaves the right open amounts when one transaction pays two invoices and two transactions pay one', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const pending: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.PENDING);

        for (const [number, amount] of [['2026-SMALLS-0001', '238'], ['2026-SMALLS-0002', '119'], ['2026-SIEMEN-0002', '50'], ['2026-SIEMEN-0002', '69']] as const) {
            expect((await decide(team, findRequest(team, pending, number, amount), 'approve')).body.request.status).toBe(ApprovalRequestStatus.APPROVED);
        }

        expect(await findPaymentState(team, '2026-SMALLS-0001')).toEqual(['PAID', '238.00', '0.00']);
        expect(await findPaymentState(team, '2026-SMALLS-0002')).toEqual(['PAID', '119.00', '0.00']);
        expect(await findPaymentState(team, '2026-SIEMEN-0002')).toEqual(['PAID', '119.00', '0.00']);
        const ofTransaction: Answer<PaginationResult<BankMatchModel>> = await call(
            `/bank/matches?page=1&limit=10&transactionId=${await findTransactionId(team, '357')}`,
            team.admin
        );
        expect(ofTransaction.body.items.map(m => m.amount).sort()).toEqual(['119', '238']);
        const ofInvoice: Answer<PaginationResult<BankMatchModel>> = await call(
            `/bank/matches?page=1&limit=10&invoiceId=${invoiceOf(team, '2026-SIEMEN-0002').id}`,
            team.clerk
        );
        expect(ofInvoice.body.items.map(m => m.amount).sort()).toEqual(['50', '69']);
    });

    it('refuses a match above what is open of the invoice or the transaction, also once it was paid in part meanwhile', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const pending: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.PENDING);
        const garden: string = await findTransactionId(team, '119');

        // a person matching the payment of 119.00 with the whole of 2026-SIEMEN-0002, which the policy leaves to
        // a person, whatever confidence they name
        const proposed: Answer<ApprovalRequestDetailsModel> = await call('/approval-requests', team.clerk, {
            method: 'POST',
            body: JSON.stringify({
                action: 'bank.match',
                input: { transactionId: garden, targetType: 'INVOICE', targetId: invoiceOf(team, '2026-SIEMEN-0002').id, amount: '119', confidence: 1 },
                reason: 'Siemens paid from the account of its director'
            })
        });
        expect(proposed.body.request.status).toBe(ApprovalRequestStatus.PENDING);
        expect((await decide(team, proposed.body.request, 'approve')).body.request.status).toBe(ApprovalRequestStatus.APPROVED);

        const partPayment: Answer<ApprovalRequestDetailsModel> = await decide(team, findRequest(team, pending, '2026-SIEMEN-0002', '50'), 'approve');
        expect(partPayment.body.request.status).toBe(ApprovalRequestStatus.FAILED);
        expect(partPayment.body.decision?.error).toBe('A match of the invoice 2026-SIEMEN-0002 needs to be at most 0 EUR, what of it is open.');
        const gardenWork: Answer<ApprovalRequestDetailsModel> = await decide(team, findRequest(team, pending, '2026-MUSTER-0001', '119'), 'approve');
        expect(gardenWork.body.request.status).toBe(ApprovalRequestStatus.FAILED);
        expect(gardenWork.body.decision?.error).toBe('A match of the transaction needs to be at most 0 EUR, what of it is not matched yet.');
        expect(await findPaymentState(team, '2026-SIEMEN-0002')).toEqual(['PAID', '119.00', '0.00']);
        expect(await findPaymentState(team, '2026-MUSTER-0001')).toEqual(['OPEN', '0.00', '119.00']);
    });

    it('writes the amount and the day of the summary in the locale of the request proposing the match', async () => {
        const team: Team = await createTeam();
        await importStatement(team);

        const proposed: Answer<ApprovalRequestDetailsModel> = await call('/approval-requests?locale=de-DE', team.clerk, {
            method: 'POST',
            body: JSON.stringify({
                action: 'bank.match',
                input: { transactionId: await findTransactionId(team, '119'), targetType: 'INVOICE', targetId: invoiceOf(team, '2026-SIEMEN-0002').id, amount: '119', confidence: 1 }
            })
        });

        // the German zibri ships, with the space Intl puts between an amount and its currency, which does not break
        expect(proposed.body.request.summary).toBe('119,00 €, gezahlt von Max Mustermann am 14.11.2026, der Rechnung 2026-SIEMEN-0002 zuordnen.');
    });

    it('refuses approving a suggestion of an invoice that changed since it was proposed', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const partPayment: MatchRequest = findRequest(team, await findRequests(team, ApprovalRequestStatus.PENDING), '2026-SIEMEN-0002', '50');
        await runInTenant(team.admin.tenantId, async () => await inject<Repository<Invoice>>(repositoryTokenFor(Invoice))
            .updateById(invoiceOf(team, '2026-SIEMEN-0002').id, { items: [itemOf(50)] }));

        const approved: Answer<ErrorResponseBody> = await call(`/approval-requests/${partPayment.id}/approve`, team.admin, { method: 'POST', body: '{}' });

        expect(approved.status).toBe(409);
        expect(approved.body.message).toContain(`The row ${invoiceOf(team, '2026-SIEMEN-0002').id} of invoice changed since`);
    });

    it('suggests no pair twice, none a person rejected, and those of invoices created after the import', async () => {
        const team: Team = await createTeam(['2026-SIEMEN-0001', '2026-SIEMEN-0002', '2026-SMALLS-0001', '2026-SMALLS-0002']);
        await importStatement(team);
        const partPayment: MatchRequest = findRequest(team, await findRequests(team, ApprovalRequestStatus.PENDING), '2026-SIEMEN-0002', '50');
        expect((await decide(team, partPayment, 'reject')).body.request.status).toBe(ApprovalRequestStatus.REJECTED);

        // the payment of the garden work, once its invoice exists. Neither the pending suggestions nor the rejected
        // one again
        team.invoices.set('2026-MUSTER-0001', await issueInvoice(team.admin.tenantId, '2026-MUSTER-0001'));
        const again: Answer<{ request: MatchRequest }[]> = await call('/bank/matches/suggestions', team.admin, { method: 'POST' });

        expect(again.status).toBe(200);
        expect(describeRequests(team, again.body.map(d => d.request))).toEqual([['2026-MUSTER-0001', '119', 0.4]]);
        expect((await call<unknown[]>('/bank/matches/suggestions', team.admin, { method: 'POST' })).body).toEqual([]);
        const reader: Member = await addMember(team.admin.tenantId, [ZibriBankPermissions.BANK_TRANSACTIONS_READ]);
        expect((await call('/bank/matches/suggestions', reader, { method: 'POST' })).status).toBe(403);
        expect((await call('/bank/matches?page=1&limit=10', reader)).status).toBe(403);
    });

    it('counts the credit notes of an invoice off what is open, and suggests no invoice credited in full', async () => {
        const team: Team = await createTeam();
        await runInTenant(team.admin.tenantId, async () => {
            const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
                ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
            );
            await cancellations.createCreditNote(invoiceOf(team, '2026-SIEMEN-0002').id, [itemOf(50)]);
            await cancellations.cancelInvoice(invoiceOf(team, '2026-SMALLS-0002').id);
        });
        expect(await findPaymentState(team, '2026-SIEMEN-0002')).toEqual(['OPEN', '0.00', '59.50']);
        expect(await findPaymentState(team, '2026-SMALLS-0002')).toEqual(['CREDITED', '0.00', '0.00']);

        await importStatement(team);

        const pending: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.PENDING);
        expect(describeRequests(team, pending)).toEqual([
            ['2026-MUSTER-0001', '119', 0.4],
            ['2026-SIEMEN-0002', '50', 0.75],
            ['2026-SIEMEN-0002', '9.5', 0.75],
            ['2026-SMALLS-0001', '238', 0.75]
        ]);
        await decide(team, findRequest(team, pending, '2026-SIEMEN-0002', '50'), 'approve');
        expect(await findPaymentState(team, '2026-SIEMEN-0002')).toEqual(['PARTLY_PAID', '50.00', '9.50']);
    });

    it('approves nothing on its own without a confidence configured', () => {
        const action: BankMatchApprovalAction = new BankMatchApprovalAction({
            store: 'bank-statements',
            retention: { years: 8 },
            matching: { paymentDifferenceTolerance: 0 }
        });

        expect(action.policies).toEqual([]);
    });

    it('reverses a match once, which opens the invoice again', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const [match] = (await call<PaginationResult<BankMatchModel>>(
            `/bank/matches?page=1&limit=10&invoiceId=${invoiceOf(team, '2026-SIEMEN-0001').id}`,
            team.admin
        )).body.items;

        expect((await call(`/bank/matches/${match?.id}/reversal`, team.clerk, { method: 'POST' })).status).toBe(403);
        const reversal: Answer<BankMatchModel> = await call(`/bank/matches/${match?.id}/reversal`, team.admin, { method: 'POST' });

        expect(reversal.status).toBe(200);
        expect(reversal.body).toMatchObject({
            transactionId: match?.transactionId,
            targetId: match?.targetId,
            amount: '-238',
            reversesMatchId: match?.id,
            requestId: null,
            confirmedBy: team.admin.userId,
            confirmedByKind: ApprovalActorKind.USER
        });
        expect(await findPaymentState(team, '2026-SIEMEN-0001')).toEqual(['OPEN', '0.00', '238.00']);
        const again: Answer<ErrorResponseBody> = await call(`/bank/matches/${match?.id}/reversal`, team.admin, { method: 'POST' });
        expect(again.status).toBe(409);
        expect(again.body.message).toBe(`The match "${match?.id}" is reversed already, and a match is reversed at most once.`);
        expect((await call(`/bank/matches/${reversal.body.id}/reversal`, team.admin, { method: 'POST' })).status).toBe(409);
        // the transaction is open again, and suggested for the invoice once more
        const suggested: Answer<{ request: MatchRequest }[]> = await call('/bank/matches/suggestions', team.admin, { method: 'POST' });
        expect(describeRequests(team, suggested.body.map(d => d.request))).toEqual([['2026-SIEMEN-0001', '238', 1]]);
    });
});

describe('the routes of the transactions and their suggestions', () => {
    it('list the transactions open and matched in full, each with what of it is open, to a member who may read them', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const reader: Member = await addMember(team.admin.tenantId, [ZibriBankPermissions.BANK_TRANSACTIONS_READ]);

        const open: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('/bank/transactions?page=1&limit=100&status=OPEN', reader);
        const matched: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('/bank/transactions?page=1&limit=100&status=MATCHED', reader);

        expect(open.status).toBe(200);
        // the payment the policy approved is matched in full, and the money paid is open without its sign
        expect(open.body.items.map(d => [d.transaction.amount, d.openAmount]).sort()).toEqual([
            ['-20', '20'],
            ['119', '119'],
            ['357', '357'],
            ['50', '50'],
            ['69', '69']
        ]);
        expect(open.body.totalAmount).toBe(5);
        expect(matched.body.items.map(d => [d.transaction.amount, d.openAmount])).toEqual([['238', '0']]);
        expect((await call('/bank/transactions?page=1&limit=100', team.clerk)).status).toBe(403);
    });

    it('answer the pending suggestions of a transaction, by the request they are decided by', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const reader: Member = await addMember(team.admin.tenantId, [ZibriBankPermissions.BANK_TRANSACTIONS_READ]);
        const twoInvoices: string = await findTransactionId(team, '357');
        const pending: MatchRequest[] = await findRequests(team, ApprovalRequestStatus.PENDING);

        const suggestions: Answer<BankTransactionSuggestionModel[]> = await call(`/bank/transactions/${twoInvoices}/suggestions`, reader);

        expect(suggestions.status).toBe(200);
        expect(suggestions.body.map(s => [s.requestId, s.targetType, s.targetId, s.amount, s.confidence, s.paymentDifference]).sort()).toEqual([
            [findRequest(team, pending, '2026-SMALLS-0001', '238').id, 'INVOICE', invoiceOf(team, '2026-SMALLS-0001').id, '238', 0.75, null],
            [findRequest(team, pending, '2026-SMALLS-0002', '119').id, 'INVOICE', invoiceOf(team, '2026-SMALLS-0002').id, '119', 0.75, null]
        ].sort());
        // decided, it is no longer a suggestion
        await decide(team, findRequest(team, pending, '2026-SMALLS-0001', '238'), 'reject');
        const left: Answer<BankTransactionSuggestionModel[]> = await call(`/bank/transactions/${twoInvoices}/suggestions`, reader);
        expect(left.body.map(s => s.targetId)).toEqual([invoiceOf(team, '2026-SMALLS-0002').id]);
        // the matched one has none
        expect((await call<unknown[]>(`/bank/transactions/${await findTransactionId(team, '238')}/suggestions`, reader)).body).toEqual([]);
        expect((await call(`/bank/transactions/${twoInvoices}/suggestions`, team.clerk)).status).toBe(403);
    });

    it('find no transaction of another tenant', async () => {
        const team: Team = await createTeam();
        await importStatement(team);
        const stranger: Team = await createTeam([]);
        const twoInvoices: string = await findTransactionId(team, '357');

        const suggestions: Answer<ErrorResponseBody> = await call(`/bank/transactions/${twoInvoices}/suggestions`, stranger.admin);

        expect(suggestions.status).toBe(404);
        const transactions: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('/bank/transactions?page=1&limit=100', stranger.admin);
        expect(transactions.body.totalAmount).toBe(0);
    });

    it('refuse a status it does not know, a day with a time and an until before from with a 400 saying what they need to be', async () => {
        const team: Team = await createTeam([]);

        const status: Answer<ErrorResponseBody> = await call('/bank/transactions?page=1&limit=10&status=PAID', team.admin);
        const time: Answer<ErrorResponseBody> = await call('/bank/transactions?page=1&limit=10&from=2026-11-03T10:00:00.000Z', team.admin);
        const before: Answer<ErrorResponseBody> = await call('/bank/transactions?page=1&limit=10&from=2026-11-03&until=2026-11-02', team.admin);

        expect([status.status, time.status, before.status]).toEqual([400, 400, 400]);
        expect(JSON.stringify(status.body)).toContain('OPEN');
        expect(time.body.message).toBe('The from needs to be a day without a time, such as 2026-03-31.');
        expect(before.body.message).toBe('The until needs to be on or after the from, 2026-11-03.');
    });
});