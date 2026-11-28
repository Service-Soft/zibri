import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type BankAccountModel,
    type BankStatementImportModel,
    type BankStatementModel,
    type BankTransactionDetailsModel,
    type ErrorResponseBody,
    type PaginationResult } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
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
import { getZonedDate } from '../../localization/get-zoned-date.function';
import { ZonedDate } from '../../localization/models/zoned-date.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ApprovalRequestController } from '../approval/approval-request.controller';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ApprovalDecision } from '../approval/models/approval-decision.model';
import { ApprovalRequest } from '../approval/models/approval-request.model';
import { ZibriApprovalPermissions } from '../approval/models/zibri-approval-permissions.model';
import { BankController } from './bank.controller';
import { ZibriBankPlugin } from './bank.plugin';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount } from './models/bank-account.model';
import { BankStatement } from './models/bank-statement.model';
import { BankTransactionState } from './models/bank-transaction-state.model';
import { BankTransaction } from './models/bank-transaction.model';
import { ZibriBankPermissions } from './models/zibri-bank-permissions.model';

const statementsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bank-controller-statements-${UUIDUtilities.generate()}`);

// the store the application keeps its documents in, which the options name in place of bank-statements
@FileStore()
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', statementsFolder);
    }
}

@Controller('/bank', { versions: 'all' })
class AppBankController extends BankController {}

// the approval requests of an application that does not match its transactions
@Controller('/approval-requests', { versions: 'all' })
class AppApprovalRequestController extends ApprovalRequestController {}

const PERMISSIONS: Permission[] = [...Object.values(ZibriBankPermissions), ...Object.values(ZibriApprovalPermissions)];

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [ZibriBankPermissions.BANK_TRANSACTIONS_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

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
        fileStores: [DocumentFileStore],
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
                    ApprovalRequest,
                    ApprovalDecision
                ],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [AppBankController, AppApprovalRequestController],
        plugins: [new ZibriBankPlugin(), new ZibriApprovalPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: [] }, roles),
            // kept in the store of the documents, and 10 years rather than the 8 of the plugin
            defineProvider({ token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { store: 'documents', retention: { years: 10 } } })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Creates a tenant, and an api key of a member of it with the given role.
 * @param role - The role of the member.
 * @returns The tenant and the key.
 */
async function createMember(role: MemberRoles): Promise<{ tenantId: string, key: string }> {
    const tenantId: string = (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [Roles.USER] });
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'bank',
            permissions: await authService.resolveUserPermissions(user, tenantId),
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return { tenantId, key: created.key };
}

/**
 * Calls a route of the bank.
 * @param path - The path below the bank, such as `accounts`.
 * @param caller - The tenant and the key of the caller.
 * @param caller.tenantId - The tenant the request names.
 * @param caller.key - The api key it sends.
 * @param init - The method and the body.
 * @returns The status and the body of the answer.
 */
async function call<T>(path: string, caller: { tenantId: string, key: string }, init: RequestInit = {}): Promise<Answer<T>> {
    const headers: Record<string, string> = { 'x-api-key': caller.key, 'x-tenant-id': caller.tenantId };
    if (typeof init.body === 'string') {
        headers['content-type'] = 'application/json';
    }
    const res: Response = await fetch(`${baseUrl}/bank/${path}`, { ...init, headers });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

async function upload<T = BankStatementImportModel>(caller: { tenantId: string, key: string }, sample: string): Promise<Answer<T>> {
    const form: FormData = new FormData();
    const data: string = await FsUtilities.readFile(FsUtilities.getPath(__dirname, '__testing__', sample));
    form.append('file', new Blob([data], { type: 'text/xml' }), sample);
    return await call<T>('statements', caller, { method: 'POST', body: form });
}

describe('the routes of the bank', () => {
    it('add an account, import a file into it, and list its statements and transactions', async () => {
        const admin: { tenantId: string, key: string } = await createMember(MemberRoles.ADMIN);

        const account: Answer<BankAccountModel> = await call('accounts', admin, {
            method: 'POST',
            body: JSON.stringify({ iban: 'de89 3704 0044 0532 0130 00', name: 'Business account', currency: 'EUR' })
        });
        expect(account).toMatchObject({ status: 200, body: { iban: 'DE89370400440532013000', name: 'Business account', tenantId: admin.tenantId } });

        const imported: Answer<BankStatementImportModel> = await upload(admin, 'camt053-001-08.sample.xml');
        expect(imported.status).toBe(200);
        expect(imported.body).toMatchObject({ skippedStatementCount: 0, transactionCount: 2, skippedTransactionCount: 0 });
        expect(imported.body.statements[0]).toMatchObject({
            accountId: account.body.id,
            bankStatementId: 'S-2026-002',
            openingBalance: '1833.01',
            closingBalance: '2133',
            file: { name: 'camt053-001-08.sample.xml', mimeType: 'application/xml' }
        });

        const statements: Answer<PaginationResult<BankStatementModel>> = await call(`statements?page=1&limit=10&accountId=${account.body.id}`, admin);
        expect(statements.body.totalAmount).toBe(1);
        // the retention the application configured, counted from the end of the year the statement was created in
        const retainUntil: ZonedDate = getZonedDate(
            new Date(statements.body.items[0]?.retainUntil ?? ''),
            inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
        );
        expect([retainUntil.year, retainUntil.month, retainUntil.day]).toEqual([2037, 0, 1]);
        // and the original file in the store the options name
        const statement: BankStatement | undefined = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(admin.tenantId, async () => await inject<Repository<BankStatement>>(repositoryTokenFor(BankStatement)).findOne({ where: { bankStatementId: 'S-2026-002' } }));
        const record: FileRecord | undefined = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(admin.tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(statement?.file ?? ''));
        expect(record?.storeName).toBe('documents');

        const transactions: Answer<PaginationResult<BankTransactionDetailsModel>> = await call(
            'transactions?page=1&limit=10&from=2026-11-03&until=2026-11-03',
            admin
        );
        expect(transactions.body.items.map(d => [d.transaction.amount, d.transaction.counterpartyName]).sort()).toEqual([
            ['250', 'Small Shop'],
            ['49.99', 'Hosting Inc']
        ]);
        expect((await call<BankAccountModel[]>('accounts', admin)).body.map(a => a.iban)).toEqual(['DE89370400440532013000']);
    });

    it('answer every transaction open, and with no suggestion, when the application does not match its transactions', async () => {
        const admin: { tenantId: string, key: string } = await createMember(MemberRoles.ADMIN);
        await call('accounts', admin, {
            method: 'POST',
            body: JSON.stringify({ iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' })
        });
        await upload(admin, 'camt053-001-08.sample.xml');

        const open: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('transactions?page=1&limit=10&status=OPEN', admin);
        const matched: Answer<PaginationResult<BankTransactionDetailsModel>> = await call('transactions?page=1&limit=10&status=MATCHED', admin);

        expect(open.body.items.map(d => [d.transaction.amount, d.openAmount]).sort()).toEqual([['250', '250'], ['49.99', '49.99']]);
        expect(matched.body.totalAmount).toBe(0);
        const suggestions: Answer<unknown[]> = await call(`transactions/${open.body.items[0]?.transaction.id}/suggestions`, admin);
        expect(suggestions).toEqual({ status: 200, body: [] });
    });

    it('refuse a file of an IBAN the tenant has no account of with a 409 naming it', async () => {
        const admin: { tenantId: string, key: string } = await createMember(MemberRoles.ADMIN);

        const imported: Answer<ErrorResponseBody> = await upload<ErrorResponseBody>(admin, 'camt053-001-08.sample.xml');

        expect(imported.status).toBe(409);
        expect(imported.body.message).toContain('DE89370400440532013000');
    });

    it('refuse importing and adding accounts to a member who may only read', async () => {
        const reader: { tenantId: string, key: string } = await createMember(MemberRoles.USER);

        expect((await upload(reader, 'camt053-001-08.sample.xml')).status).toBe(403);
        const account: Answer<unknown> = await call('accounts', reader, {
            method: 'POST',
            body: JSON.stringify({ iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' })
        });
        expect(account.status).toBe(403);
        expect((await call<PaginationResult<BankTransactionDetailsModel>>('transactions?page=1&limit=10', reader)).status).toBe(200);
    });

    it('refuse proposing a match with a 409 when the application does not match its transactions, storing no request', async () => {
        const admin: { tenantId: string, key: string } = await createMember(MemberRoles.ADMIN);
        const headers: Record<string, string> = { 'x-api-key': admin.key, 'x-tenant-id': admin.tenantId, 'content-type': 'application/json' };

        const proposed: Response = await fetch(`${baseUrl}/approval-requests`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'bank.match',
                input: { transactionId: UUIDUtilities.generate(), targetType: 'INVOICE', targetId: UUIDUtilities.generate(), amount: '50' }
            })
        });

        expect(proposed.status).toBe(409);
        expect(((await proposed.json()) as ErrorResponseBody).message).toBe('This application does not match bank transactions with invoices.');
        const stored: boolean = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(admin.tenantId, async () => await inject<Repository<ApprovalRequest>>(repositoryTokenFor(ApprovalRequest)).exists());
        expect(stored).toBe(false);
    });
});