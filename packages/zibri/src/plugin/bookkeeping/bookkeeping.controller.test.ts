import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { type BookkeepingAccountModel,
    type BookkeepingClosingProposalModel,
    type BookkeepingJournalReportModel,
    type BookkeepingLedgerReportModel,
    type BookkeepingRevenueReportModel,
    type BookkeepingSettingsModel,
    type BookkeepingStatementFormChoicesModel,
    type BookkeepingStatementModel,
    type BookkeepingTrialBalanceModel,
    type BookkeepingVerificationModel,
    type ErrorResponseBody,
    type ExpenseDataModel,
    type ExpenseModel,
    type ExpenseReceiptModel,
    type FiscalYearClosingResultModel,
    type FiscalYearModel,
    type FiscalYearReopeningResultModel,
    type JournalEntryDetailsModel,
    JournalEntryLineRole,
    type JournalEntryPageModel,
    type NewJournalEntryModel,
    type PaginationResult,
    type PostingRuleSetModel } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { OtpCredentials, type OtpCredentialsCreateData } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { CronJobEntity } from '../../cron/cron-job-entity.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { readExport, type ReadExport } from './bookkeeping-export.cases';
import { BookkeepingVerificationCronJob } from './bookkeeping-verification.cron-job';
import { bookkeepingTestEntities, bookkeepingTestOptions, ReceiptsFileStore, receiptsFolder, storeOf } from './bookkeeping.cases';
import { BookkeepingController } from './bookkeeping.controller';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { JournalEntry } from './models/journal-entry.model';
import { ZibriBookkeepingPermissions, ZibriBookkeepingPlatformPermissions } from './models/zibri-bookkeeping-permissions.model';

@Controller('/bookkeeping', { versions: 'all' })
class AppBookkeepingController extends BookkeepingController {}

const PERMISSIONS: Permission[] = Object.values(ZibriBookkeepingPermissions);

// eslint-disable-next-line cspell/spellchecker
const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';
const PLATFORM_PERMISSIONS: PlatformPermission[] = Object.values(ZibriBookkeepingPlatformPermissions);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: PLATFORM_PERMISSIONS, description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [ZibriBookkeepingPermissions.BOOKKEEPING_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

/**
 * The answer of a route.
 */
type Answer<T> = {
    status: number,
    body: T
};

/**
 * Who calls a route: the tenant the request names, if any, and the api key it sends.
 */
type Caller = {
    tenantId: string | undefined,
    key: string,
    userId: string
};

/**
 * The books an admin of a tenant set up through the routes.
 */
type Books = {
    admin: Caller,
    settings: BookkeepingSettingsModel,
    accounts: Record<'bank' | 'capital' | 'result' | 'rent' | 'inputTax' | 'payables', BookkeepingAccountModel>,
    fiscalYear: FiscalYearModel
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ApiKey, TestTenant, ...bookkeepingTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        // the second factor reopening a fiscal year asks for
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [AppBookkeepingController],
        plugins: [new ZibriBookkeepingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            bookkeepingTestOptions,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: PLATFORM_PERMISSIONS }, roles)
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Creates a user with roles of their own and in a tenant, and an api key acting as them.
 * @param platformRoles - Their roles of their own.
 * @param tenantRole - Their role in the tenant, none when undefined.
 * @param memberOf - The tenant they are a member of, a new one by default.
 * @returns The tenant and the key.
 */
async function createCaller(platformRoles: Roles[], tenantRole: MemberRoles | undefined, memberOf?: string): Promise<Caller> {
    const tenantId: string | undefined = tenantRole == undefined
        ? undefined
        : memberOf ?? (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: platformRoles });
    if (tenantId != undefined && tenantRole != undefined) {
        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [tenantRole] })
        );
    }
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'bookkeeping',
            permissions: await authService.resolveUserPermissions(user, tenantId),
            expiresAt: undefined,
            tenantId: undefined,
            clientAuthentication: undefined,
            requireDpop: false
        },
        undefined
    );
    return { tenantId, key: created.key, userId: user.id };
}

/**
 * Calls a route of the books.
 * @param path - The path below the books, such as `accounts`.
 * @param caller - Who calls it.
 * @param method - The method.
 * @param body - The json body, or a multipart one, none by default.
 * @param sent - Further headers, such as a one time password.
 * @returns The status and the body of the answer.
 */
async function call<T>(
    path: string,
    caller: Caller,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
    sent: Record<string, string> = {}
): Promise<Answer<T>> {
    const headers: Record<string, string> = { 'x-api-key': caller.key, ...sent };
    if (caller.tenantId != undefined) {
        headers['x-tenant-id'] = caller.tenantId;
    }
    const multipart: boolean = body instanceof FormData;
    if (body != undefined && !multipart) {
        headers['content-type'] = 'application/json';
    }
    const res: Response = await fetch(`${baseUrl}/bookkeeping/${path}`, {
        method,
        headers,
        body: body == undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

/**
 * Sets up the books of a new tenant through the routes, as its admin.
 * @returns The books.
 */
async function createBooks(): Promise<Books> {
    const admin: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
    const settings: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'POST', {
        currency: 'EUR',
        legalForms: [{ legalForm: 'GmbH', validFrom: '2020-01-01' }],
        company: { name: 'Acme GmbH', seat: 'Berlin', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B' }
    });
    expect(settings).toMatchObject({ status: 200, body: { tenantId: admin.tenantId, currency: 'EUR', company: { name: 'Acme GmbH' } } });
    const account: (number: string, name: string, type: BookkeepingAccountType) => Promise<BookkeepingAccountModel>
        = async (number, name, type) => {
            const res: Answer<BookkeepingAccountModel> = await call('accounts', admin, 'POST', { number, name, type });
            expect(res.status).toBe(200);
            return res.body;
        };
    const bank: BookkeepingAccountModel = await account('1200', 'Bank', BookkeepingAccountType.ASSET);
    const capital: BookkeepingAccountModel = await account('2900', 'Share capital', BookkeepingAccountType.EQUITY);
    const result: BookkeepingAccountModel = await account('2970', 'Profit carried forward', BookkeepingAccountType.EQUITY);
    const rent: BookkeepingAccountModel = await account('4210', 'Rent', BookkeepingAccountType.EXPENSE);
    const inputTax: BookkeepingAccountModel = await account('1576', 'Input tax 19 %', BookkeepingAccountType.ASSET);
    const payables: BookkeepingAccountModel = await account('1600', 'Payables', BookkeepingAccountType.LIABILITY);
    const fiscalYear: Answer<FiscalYearModel> = await call('fiscal-years', admin, 'POST', { start: '2026-01-01' });
    expect(fiscalYear).toMatchObject({ status: 200, body: { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', lastSequence: 0 } });
    return { admin, settings: settings.body, accounts: { bank, capital, result, rent, inputTax, payables }, fiscalYear: fiscalYear.body };
}

/**
 * An entry of the books, as `POST /entries` takes it.
 * @param postingDate - The posting date.
 * @param debit - The account debited.
 * @param credit - The account credited.
 * @param amount - The amount.
 * @returns The entry.
 */
function entryOf(postingDate: string, debit: BookkeepingAccountModel, credit: BookkeepingAccountModel, amount: string): NewJournalEntryModel {
    return {
        documentDate: new Date(postingDate),
        postingDate: new Date(postingDate),
        text: 'Booked',
        lines: [{ accountId: debit.id, debit: amount }, { accountId: credit.id, credit: amount }]
    };
}

describe('the routes of the books', () => {
    it('start the books with their settings, accounts and fiscal year, post, reverse, close and check them', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;

        const posted: Answer<JournalEntryDetailsModel> = await call('entries', admin, 'POST', entryOf('2026-01-02', accounts.bank, accounts.capital, '1000.00'));
        expect(posted.status).toBe(200);
        expect(posted.body.entry).toMatchObject({ sequence: 1, tenantId: admin.tenantId, fiscalYearId: books.fiscalYear.id, postingDate: '2026-01-02T00:00:00.000Z' });
        expect(posted.body.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([[accounts.bank.id, '1000', null], [accounts.capital.id, null, '1000']]);

        const unbalanced: Answer<ErrorResponseBody> = await call('entries', admin, 'POST', {
            ...entryOf('2026-01-03', accounts.bank, accounts.capital, '10'),
            lines: [{ accountId: accounts.bank.id, debit: '10' }, { accountId: accounts.capital.id, credit: '9' }]
        });
        expect(unbalanced.status).toBe(400);
        expect(JSON.stringify(unbalanced.body)).toContain('The debits of the entry, 10.00, need to add up to its credits, 9.00.');

        const rent: Answer<JournalEntryDetailsModel> = await call('entries', admin, 'POST', entryOf('2026-02-01', accounts.rent, accounts.bank, '100'));
        const reversal: Answer<JournalEntryDetailsModel> = await call(`entries/${rent.body.entry.id}/reversal`, admin, 'POST', {
            postingDate: '2026-02-02',
            text: 'Wrong month'
        });
        expect(reversal.status).toBe(200);
        expect(reversal.body.entry).toMatchObject({ sequence: 3, reversesEntryId: rent.body.entry.id, text: 'Wrong month' });
        expect(reversal.body.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([[accounts.rent.id, null, '100'], [accounts.bank.id, '100', null]]);
        expect((await call(`entries/${rent.body.entry.id}/reversal`, admin, 'POST', { postingDate: '2026-02-03', text: 'Again' })).status).toBe(409);
        await call('entries', admin, 'POST', entryOf('2026-03-01', accounts.rent, accounts.bank, '100'));

        const page: Answer<PaginationResult<JournalEntryDetailsModel>> = await call('entries?page=1&limit=10', admin);
        expect(page.body.totalAmount).toBe(4);
        expect(page.body.items.map(i => [i.entry.sequence, i.lines.length])).toEqual([[1, 2], [2, 2], [3, 2], [4, 2]]);
        expect((await call<JournalEntryDetailsModel>(`entries/${reversal.body.entry.id}`, admin)).body.entry.id).toBe(reversal.body.entry.id);
        expect((await call<BookkeepingAccountModel[]>('accounts', admin)).body.map(a => a.number)).toEqual(['1200', '1576', '1600', '2900', '2970', '4210']);
        expect((await call<BookkeepingSettingsModel>('settings', admin)).body.id).toBe(books.settings.id);

        const proposals: Answer<BookkeepingClosingProposalModel[]> = await call(`fiscal-years/${books.fiscalYear.id}/closing-proposals`, admin);
        expect(proposals).toEqual({ status: 200, body: [] });
        // a GmbH, whose size class the HGB resolves by its employees
        const withoutEmployees: Answer<ErrorResponseBody> = await call(`fiscal-years/${books.fiscalYear.id}/closing`, admin, 'POST', {
            resultAccountId: accounts.result.id
        });
        expect(withoutEmployees.status).toBe(409);
        expect(JSON.stringify(withoutEmployees.body)).toContain('needs its averageEmployees');
        const employed: Answer<FiscalYearModel> = await call(`fiscal-years/${books.fiscalYear.id}`, admin, 'PATCH', {
            averageEmployees: 2,
            founded: true,
            balanceSheetNote: 'Haftungsverhältnisse bestehen nicht.'
        });
        expect(employed).toMatchObject({ status: 200, body: { averageEmployees: 2, founded: true, balanceSheetNote: 'Haftungsverhältnisse bestehen nicht.' } });
        const closed: Answer<FiscalYearClosingResultModel> = await call(`fiscal-years/${books.fiscalYear.id}/closing`, admin, 'POST', {
            resultAccountId: accounts.result.id
        });
        expect(closed.status).toBe(200);
        expect(closed.body.fiscalYear.closedAt).toEqual(expect.any(String));
        expect(closed.body.nextFiscalYear).toMatchObject({ start: '2027-01-01T00:00:00.000Z', end: '2027-12-31T00:00:00.000Z' });
        expect(closed.body.openingEntry?.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([
            [accounts.bank.id, '900', null],
            [accounts.capital.id, null, '1000'],
            [accounts.result.id, '100', null]
        ]);
        expect((await call<FiscalYearModel[]>('fiscal-years', admin)).body.map(y => y.start)).toEqual(['2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
        expect((await call('entries', admin, 'POST', entryOf('2026-12-01', accounts.rent, accounts.bank, '1'))).status).toBe(409);
        const legalForm: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { legalForm: { legalForm: 'AG', validFrom: '2026-06-01' } });
        expect(legalForm.status).toBe(409);
        expect(JSON.stringify(legalForm.body)).toContain('the end of the last closed fiscal year');
        expect((await call('settings', admin, 'POST', { currency: 'EUR', legalForms: [] })).status).toBe(409);

        const verification: Answer<BookkeepingVerificationModel> = await call('verification', admin);
        // the four posted, the closing and the opening entry
        expect(verification.body).toMatchObject({ intact: true, newestEntrySequence: 6, problems: [] });
    });

    it('reopen a closed fiscal year behind a permission of its own and a second factor given again, and record it in the audit trail', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        await call('entries', admin, 'POST', entryOf('2026-01-02', accounts.bank, accounts.capital, '1000.00'));
        await call('entries', admin, 'POST', entryOf('2026-02-01', accounts.rent, accounts.bank, '100'));
        await call(`fiscal-years/${books.fiscalYear.id}`, admin, 'PATCH', { averageEmployees: 2, founded: true });
        expect((await call(`fiscal-years/${books.fiscalYear.id}/closing`, admin, 'POST', { resultAccountId: accounts.result.id })).status).toBe(200);
        const path: string = `fiscal-years/${books.fiscalYear.id}/reopening`;
        const otpHeader: string = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        const code: () => Record<string, string> = () => ({ [otpHeader]: new TOTP({ secret: OTP_SECRET }).generate() });

        expect((await call(path, reader, 'POST', { reason: 'Rent booked twice' })).status).toBe(403);
        // the name tells a client whether to ask for a code or for a new login
        const withoutFactor: Answer<ErrorResponseBody> = await call(path, admin, 'POST', { reason: 'Rent booked twice' });
        expect([withoutFactor.status, withoutFactor.body.name]).toEqual([401, 'ReauthenticationRequiredError']);
        const otp: Repository<OtpCredentials, OtpCredentialsCreateData> = inject(repositoryTokenFor(OtpCredentials));
        await otp.updateById((await otp.create({ secret: OTP_SECRET, userId: admin.userId })).id, { confirmed: true });
        const missing: Answer<ErrorResponseBody> = await call(path, admin, 'POST', { reason: 'Rent booked twice' });
        expect([missing.status, missing.body.name]).toEqual([401, 'SecondFactorMissingError']);

        const reopened: Answer<FiscalYearReopeningResultModel> = await call(path, admin, 'POST', { reason: 'Rent booked twice' }, code());

        expect(reopened.status).toBe(200);
        expect([reopened.body.fiscalYear.closedAt, reopened.body.fiscalYear.reopenings, reopened.body.closingReversal?.entry.createdBy])
            .toEqual([null, 1, admin.userId]);
        expect(reopened.body.openingReversal?.entry.fiscalYearId).toBe(reopened.body.nextFiscalYear?.id);
        expect((await call('entries', admin, 'POST', entryOf('2026-12-01', accounts.bank, accounts.rent, '100'))).status).toBe(200);
        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const recorded: AuditEntry[] = await inject<Repository<AuditEntry>>(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.BOOKKEEPING_FISCAL_YEAR_REOPENED, subject: books.fiscalYear.id },
            acrossTenants: true,
            limit: 'all'
        });
        expect(recorded.map(e => [e.tenantId, e.outcome, e.userId])).toEqual([[admin.tenantId, AuditOutcome.SUCCESS, admin.userId]]);
    });

    it('refuse an entry with a line of a role, which only the closing of a fiscal year sets, and store nothing', async () => {
        const { admin, accounts } = await createBooks();
        const entry: NewJournalEntryModel = entryOf('2026-03-01', accounts.rent, accounts.bank, '100');

        const posted: Answer<ErrorResponseBody> = await call('entries', admin, 'POST', {
            ...entry,
            lines: [entry.lines[0], { ...entry.lines[1], role: JournalEntryLineRole.RESULT }]
        });
        expect(posted.status).toBe(400);
        expect(JSON.stringify(posted.body)).toContain('this key is unknown');
        expect((await call<JournalEntryPageModel>('entries?page=1&limit=10', admin)).body.totalAmount).toBe(0);
    });

    it('change the currency, replace or remove the company and append a legal form, leaving what a change does not name as it is', async () => {
        const admin: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
        // of a legal form no conformance applies to, whose company needs nothing but its name
        const created: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'POST', {
            currency: 'EUR',
            legalForms: [{ legalForm: 'e.K.', validFrom: '2020-01-01' }],
            company: { name: 'Acme', seat: 'Berlin' }
        });
        expect(created.status).toBe(200);

        expect(await call('settings', admin, 'PATCH', { currency: 'USD' })).toMatchObject({
            status: 200,
            body: { currency: 'USD', legalForms: created.body.legalForms, company: { name: 'Acme', seat: 'Berlin' } }
        });

        const replaced: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'PATCH', { company: { name: 'Acme Holding' } });
        const read: Answer<BookkeepingSettingsModel> = await call('settings', admin);
        expect(replaced.status).toBe(200);
        for (const company of [replaced.body.company, read.body.company]) {
            expect([company?.name, company?.seat ?? null]).toStrictEqual(['Acme Holding', null]);
        }
        expect(read.body.currency).toBe('USD');

        const removed: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'PATCH', { company: null });
        expect(removed.status).toBe(200);
        expect(removed.body.company ?? null).toBeNull();
        expect((await call<BookkeepingSettingsModel>('settings', admin)).body.company ?? null).toBeNull();

        // a GmbH needs the register of its company, which the conformances check of the settings the change results in
        const withoutRegister: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { legalForm: { legalForm: 'GmbH', validFrom: '2027-01-01' } });
        expect(withoutRegister.status).toBe(400);
        expect(JSON.stringify(withoutRegister.body)).toContain('The bookkeeping settings of a GmbH need the name, seat, registerCourt, registerNumber of its company');
        const gmbh: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'PATCH', {
            legalForm: { legalForm: 'GmbH', validFrom: '2027-01-01' },
            company: { name: 'Acme GmbH', seat: 'Berlin', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B' }
        });
        expect(gmbh.status).toBe(200);
        expect(gmbh.body.legalForms).toStrictEqual([
            { legalForm: 'e.K.', validFrom: '2020-01-01T00:00:00.000Z' },
            { legalForm: 'GmbH', validFrom: '2027-01-01T00:00:00.000Z' }
        ]);
        expect((await call<BookkeepingSettingsModel>('settings', admin)).body).toStrictEqual(gmbh.body);
        const withoutSeat: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { company: { name: 'Acme GmbH' } });
        expect(withoutSeat.status).toBe(400);
        expect(JSON.stringify(withoutSeat.body)).toContain('The bookkeeping settings of a GmbH need the seat, registerCourt, registerNumber of its company');

        const beforeLatest: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { legalForm: { legalForm: 'AG', validFrom: '2026-01-01' } });
        expect(beforeLatest.status).toBe(409);
        expect(JSON.stringify(beforeLatest.body)).toContain('the day the latest legal form is valid from');
        expect((await call('fiscal-years', admin, 'POST', { start: '2026-01-01' })).status).toBe(200);
        const currency: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { currency: 'EUR' });
        expect(currency.status).toBe(409);
        expect(JSON.stringify(currency.body)).toContain('The currency of the books needs to stay USD, as a fiscal year is kept in it.');
    });

    it('refuse to remove the company of a UG', async () => {
        const admin: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
        const created: Answer<BookkeepingSettingsModel> = await call('settings', admin, 'POST', {
            currency: 'EUR',
            legalForms: [{ legalForm: 'UG', validFrom: '2020-01-01' }],
            company: { name: 'Acme UG (haftungsbeschränkt)', seat: 'Berlin', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B' }
        });
        expect(created.status).toBe(200);

        const removed: Answer<ErrorResponseBody> = await call('settings', admin, 'PATCH', { company: null });

        expect(removed.status).toBe(400);
        expect(JSON.stringify(removed.body)).toContain('The bookkeeping settings of a UG need the name, seat, registerCourt, registerNumber of its company');
        expect((await call<BookkeepingSettingsModel>('settings', admin)).body).toStrictEqual(created.body);
    });

    it('apply a change of the settings whole or not at all', async () => {
        const books: Books = await createBooks();
        const company: Record<string, string> = {
            name: 'Acme Holding GmbH',
            seat: 'Hamburg',
            registerCourt: 'Amtsgericht Hamburg',
            registerNumber: 'HRB 654321'
        };

        // a valid company beside a legal form valid from before the latest one
        const legalForm: Answer<ErrorResponseBody> = await call('settings', books.admin, 'PATCH', {
            company,
            legalForm: { legalForm: 'AG', validFrom: '2019-01-01' }
        });
        // a valid company and legal form beside a currency changed while a fiscal year is kept
        const currency: Answer<ErrorResponseBody> = await call('settings', books.admin, 'PATCH', {
            company,
            legalForm: { legalForm: 'AG', validFrom: '2027-01-01' },
            currency: 'USD'
        });

        expect(legalForm.status).toBe(409);
        expect(JSON.stringify(legalForm.body)).toContain('the day the latest legal form is valid from');
        expect(currency.status).toBe(409);
        expect(JSON.stringify(currency.body)).toContain('The currency of the books needs to stay EUR, as a fiscal year is kept in it.');
        expect((await call<BookkeepingSettingsModel>('settings', books.admin)).body).toStrictEqual(books.settings);
    });

    it('set up posting rules, and enter, record and correct an expense with its receipt', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;
        const ruleSet: Answer<PostingRuleSetModel> = await call('posting-rule-sets', admin, 'POST', {
            fiscalYearId: books.fiscalYear.id,
            rules: {
                payablesAccountId: accounts.payables.id,
                revenueAccounts: [],
                outputTaxAccounts: [],
                inputTaxAccounts: [{ rate: 19, accountId: accounts.inputTax.id }],
                paymentDifferenceAccounts: [],
                bankAccounts: []
            }
        });
        expect(ruleSet).toMatchObject({ status: 200, body: { fiscalYearId: books.fiscalYear.id, validFrom: '2026-01-01T00:00:00.000Z' } });
        const form: FormData = new FormData();
        form.append('file', new Blob(['%PDF-1.4 rent'], { type: 'application/pdf' }), 'rent-2026-03.pdf');
        const receipt: Answer<ExpenseReceiptModel> = await call('expense-receipts', admin, 'POST', form);
        expect(receipt).toMatchObject({ status: 200, body: { file: { name: 'rent-2026-03.pdf', mimeType: 'application/pdf' } } });

        const data: ExpenseDataModel = {
            supplier: { name: 'Landlord GmbH' },
            documentNumber: 'R-2026-03',
            documentDate: new Date('2026-03-01'),
            totals: [{ rate: 19, net: '500.00', tax: '95.00' }],
            currency: 'EUR',
            accountId: accounts.rent.id,
            receiptId: receipt.body.id
        };
        const draft: Answer<ExpenseModel> = await call('expenses', admin, 'POST', data);
        expect(draft).toMatchObject({ status: 200, body: { recordedAt: null, postedEntryId: null, receiptId: receipt.body.id } });
        const changedData: ExpenseDataModel = { ...data, totals: [{ rate: 19, net: '600.00', tax: '114.00' }] };
        const changed: Answer<ExpenseModel> = await call(`expenses/${draft.body.id}`, admin, 'PUT', changedData);
        expect(changed.body.totals).toEqual([{ rate: 19, net: '600', tax: '114' }]);
        const recorded: Answer<ExpenseModel> = await call(`expenses/${draft.body.id}/recording`, admin, 'POST');
        expect(recorded.status).toBe(200);
        expect(recorded.body.recordedAt).toEqual(expect.any(String));
        const entry: Answer<JournalEntryDetailsModel> = await call(`entries/${recorded.body.postedEntryId}`, admin);
        expect(entry.body.entry).toMatchObject({ sourceType: 'bookkeeping.expense', sourceId: draft.body.id, documentReference: 'R-2026-03' });
        expect(entry.body.lines.map(l => [l.accountId, l.debit, l.credit])).toEqual([
            [accounts.rent.id, '600', null],
            [accounts.inputTax.id, '114', null],
            [accounts.payables.id, null, '714']
        ]);
        expect((await call(`expenses/${draft.body.id}`, admin, 'PUT', changedData)).status).toBe(409);
        expect((await call(`expenses/${draft.body.id}`, admin, 'DELETE')).status).toBe(409);

        const correction: Answer<ExpenseModel> = await call(`expenses/${draft.body.id}/correction`, admin, 'POST', data);
        expect(correction).toMatchObject({ status: 200, body: { correctsExpenseId: draft.body.id, recordedAt: expect.any(String) } });
        const journalPage: Answer<PaginationResult<JournalEntryDetailsModel>> = await call('entries?page=1&limit=10', admin);
        // the first posting, its reversal and the corrected one
        expect(journalPage.body.items.map(i => [i.entry.sequence, i.entry.reversesEntryId ?? null, i.lines.find(l => l.accountId === accounts.payables.id)]))
            .toEqual([
                [1, null, expect.objectContaining({ credit: '714' })],
                [2, recorded.body.postedEntryId, expect.objectContaining({ debit: '714' })],
                [3, null, expect.objectContaining({ credit: '595' })]
            ]);
        expect((await call(`expenses/${draft.body.id}/correction`, admin, 'POST', changedData)).status).toBe(409);
        expect((await call<PaginationResult<ExpenseModel>>('expenses?page=1&limit=10', admin)).body.totalAmount).toBe(2);
        // found by the document number or the supplier, such as to pick the one a bank transaction pays
        expect((await call<PaginationResult<ExpenseModel>>('expenses?page=1&limit=10&search=LANDLORD', admin)).body.totalAmount).toBe(2);
        expect((await call<PaginationResult<ExpenseModel>>('expenses?page=1&limit=10&search=2026-03', admin)).body.totalAmount).toBe(2);
        expect((await call<PaginationResult<ExpenseModel>>('expenses?page=1&limit=10&search=tenant', admin)).body.totalAmount).toBe(0);
    });

    it('answer a page of the entries with the totals of every one matching and the reversal of each, and find the accounts by a search', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        const capital: Answer<JournalEntryDetailsModel> = await call('entries', admin, 'POST', entryOf('2026-01-02', accounts.bank, accounts.capital, '1000'));
        const rent: Answer<JournalEntryDetailsModel> = await call('entries', admin, 'POST', entryOf('2026-02-01', accounts.rent, accounts.bank, '100'));
        const reversal: Answer<JournalEntryDetailsModel> = await call(`entries/${rent.body.entry.id}/reversal`, admin, 'POST', {
            postingDate: '2026-02-02',
            text: 'Wrong month'
        });

        const page: Answer<JournalEntryPageModel> = await call('entries?page=1&limit=2', reader);
        const onBank: Answer<JournalEntryPageModel> = await call(`entries?page=1&limit=1&accountId=${accounts.bank.id}`, reader);

        expect(page.status).toBe(200);
        expect([page.body.totalAmount, page.body.items.length, page.body.debit, page.body.credit]).toEqual([3, 2, '1200', '1200']);
        expect(page.body.items.map(i => [i.entry.id, i.reversedByEntryId])).toEqual([[capital.body.entry.id, null], [rent.body.entry.id, reversal.body.entry.id]]);
        expect([onBank.body.debit, onBank.body.credit]).toEqual(['1100', '100']);
        expect((await call<JournalEntryDetailsModel>(`entries/${rent.body.entry.id}`, reader)).body.reversedByEntryId).toBe(reversal.body.entry.id);
        expect(reversal.body.reversedByEntryId).toBeNull();

        const found: Answer<BookkeepingAccountModel[]> = await call('accounts?search=pay', reader);
        const byNumber: Answer<BookkeepingAccountModel[]> = await call('accounts?search=29&open=true', reader);
        expect(found.body.map(a => a.number)).toEqual(['1600']);
        expect(byNumber.body.map(a => a.number)).toEqual(['2900', '2970']);
        expect((await call<BookkeepingAccountModel[]>('accounts?open=false', reader)).body).toEqual([]);
        expect((await call('accounts?open=maybe', reader)).status).toBe(400);

        // one account by its id, of the tenant alone
        const stranger: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
        const nobody: Caller = await createCaller([Roles.USER], undefined);
        const platform: Caller = await createCaller([Roles.ADMIN], undefined);
        expect(await call<BookkeepingAccountModel>(`accounts/${accounts.bank.id}`, reader)).toMatchObject({ status: 200, body: { id: accounts.bank.id, number: '1200' } });
        expect((await call(`accounts/${accounts.bank.id}`, stranger)).status).toBe(404);
        expect((await call(`accounts/${UUIDUtilities.generate()}`, reader)).status).toBe(404);
        expect((await call(`accounts/${accounts.bank.id}`, nobody)).status).toBe(403);
        expect((await call<BookkeepingAccountModel>(`accounts/${accounts.bank.id}`, platform)).body.tenantId).toBe(admin.tenantId);
    });

    it('answer each route with the permission it needs', async () => {
        const books: Books = await createBooks();
        const inTenant: Caller = await createCaller([Roles.USER], MemberRoles.USER, books.admin.tenantId);

        expect((await call('entries?page=1&limit=10', inTenant)).status).toBe(200);
        expect((await call('entries', inTenant, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '1'))).status).toBe(403);
        expect((await call(`fiscal-years/${books.fiscalYear.id}/closing`, inTenant, 'POST', { resultAccountId: books.accounts.result.id })).status).toBe(403);
        expect((await call('accounts', inTenant, 'POST', { number: '1000', name: 'Cash', type: 'ASSET' })).status).toBe(403);
        expect((await call('expenses?page=1&limit=10', inTenant)).status).toBe(200);
        expect((await call('expense-receipts', inTenant, 'POST', new FormData())).status).toBe(403);
        expect((await call(`fiscal-years/${books.fiscalYear.id}`, inTenant, 'PATCH', { averageEmployees: 1 })).status).toBe(403);
        expect((await call(`reports/trial-balance?fiscalYearId=${books.fiscalYear.id}`, inTenant)).status).toBe(200);
        expect((await call('settings', inTenant, 'PATCH', { currency: 'USD' })).status).toBe(403);
        expect((await call('settings', inTenant, 'PATCH', { company: { name: 'Acme Holding' } })).status).toBe(403);
        expect((await call('settings', inTenant, 'PATCH', { legalForm: { legalForm: 'AG', validFrom: '2027-01-01' } })).status).toBe(403);
    });

    it('refuse what a company holds beyond the generic one, which the application did not register as the company model', async () => {
        const books: Books = await createBooks();
        const fresh: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);

        const created: Answer<ErrorResponseBody> = await call('settings', fresh, 'POST', {
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: '2020-01-01' }],
            company: { name: 'Acme GmbH', taxNumber: '1121081508150' }
        });
        const changed: Answer<ErrorResponseBody> = await call('settings', books.admin, 'PATCH', { company: { name: 'Acme GmbH', taxOfficeNumber: '1121' } });

        expect(created.status).toBe(400);
        expect(JSON.stringify(created.body)).toContain('taxNumber');
        expect(changed.status).toBe(400);
        expect(JSON.stringify(changed.body)).toContain('taxOfficeNumber');
    });

    it('answer the reports as json and as pdf, and refuse a position no statement has', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        const bank: Answer<BookkeepingAccountModel> = await call('accounts', admin, 'POST', {
            number: '1210',
            name: 'Second bank',
            type: 'ASSET',
            statementPosition: 'assets.B.IV',
            creditStatementPosition: 'equity-and-liabilities.C.2'
        });
        expect(bank).toMatchObject({ status: 200, body: { statementPosition: 'assets.B.IV', creditStatementPosition: 'equity-and-liabilities.C.2' } });
        const refused: Answer<ErrorResponseBody> = await call('accounts', admin, 'POST', {
            number: '1220',
            name: 'Third bank',
            type: 'ASSET',
            statementPosition: 'income-statement.1'
        });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain('needs to be a position of a balance sheet');
        await call('entries', admin, 'POST', entryOf('2026-01-02', bank.body, accounts.capital, '1000.00'));
        const year: string = `fiscalYearId=${books.fiscalYear.id}`;

        const balanceSheet: Answer<BookkeepingStatementModel> = await call(`reports/balance-sheet?${year}&form=hgb.balance-sheet`, reader);
        expect(balanceSheet.status).toBe(200);
        expect(balanceSheet.body.positions.find(p => p.id === 'assets.B.IV')).toMatchObject({
            parentId: 'assets.B',
            depth: 2,
            amount: '1000',
            accounts: [{ accountId: bank.body.id, number: '1210', name: 'Second bank', amount: '1000' }]
        });
        // the share capital has no position
        expect(balanceSheet.body.unmapped).toEqual([{ accountId: accounts.capital.id, number: '2900', name: 'Share capital', amount: '1000' }]);
        expect((await call<BookkeepingStatementModel>(`reports/income-statement?${year}&form=hgb.income-statement.micro`, reader)).body)
            .toMatchObject({ type: 'INCOME_STATEMENT', form: 'hgb.income-statement.micro', result: '0' });
        // the default form of a GmbH needs its size class
        expect((await call(`reports/balance-sheet?${year}`, reader)).status).toBe(409);
        const journalReport: Answer<BookkeepingJournalReportModel> = await call('reports/journal?from=2026-01-01&until=2026-12-31', reader);
        expect(journalReport.body).toMatchObject({ debit: '1000', credit: '1000', entries: [{ entry: { sequence: 1 } }] });
        const ledger: Answer<BookkeepingLedgerReportModel> = await call(`reports/ledger?accountId=${bank.body.id}&from=2026-01-01&until=2026-12-31`, reader);
        expect(ledger.body).toMatchObject({ openingBalance: '0', closingBalance: '1000', lines: [{ debit: '1000', balance: '1000' }] });
        const trialBalance: Answer<BookkeepingTrialBalanceModel> = await call(`reports/trial-balance?${year}&until=2026-06-30`, reader);
        expect(trialBalance.body).toMatchObject({ debit: '1000', credit: '1000', debitBalances: '1000', creditBalances: '1000' });
        expect((await call<BookkeepingRevenueReportModel>('reports/revenue?year=2026', reader)).body).toMatchObject({ year: 2026, total: '0', accounts: [] });

        for (const path of [
            `reports/balance-sheet.pdf?${year}&form=hgb.balance-sheet`,
            `reports/income-statement.pdf?${year}&form=hgb.income-statement`,
            `reports/trial-balance.pdf?${year}`,
            'reports/journal.pdf?from=2026-01-01&until=2026-12-31',
            `reports/ledger.pdf?accountId=${bank.body.id}&from=2026-01-01&until=2026-12-31`,
            'reports/revenue.pdf?year=2026'
        ]) {
            const res: Response = await fetch(`${baseUrl}/bookkeeping/${path}`, { headers: { 'x-api-key': reader.key, 'x-tenant-id': admin.tenantId ?? '' } });
            expect([path, res.status, res.headers.get('content-type')]).toEqual([path, 200, 'application/pdf']);
            expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5)
                .toString()).toBe('%PDF-');
        }
    });

    it('answer the forms of the statements of a fiscal year, and a page of the entries narrowed by days and account', async () => {
        const books: Books = await createBooks();
        const other: Books = await createBooks();
        const { admin, accounts } = books;
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        await call(`fiscal-years/${books.fiscalYear.id}`, admin, 'PATCH', { averageEmployees: 2, founded: true });
        await call('entries', admin, 'POST', entryOf('2026-01-02', accounts.bank, accounts.capital, '1000.00'));
        await call('entries', admin, 'POST', entryOf('2026-02-01', accounts.rent, accounts.bank, '50.00'));
        await call('entries', admin, 'POST', entryOf('2026-03-01', accounts.bank, accounts.capital, '10.00'));

        const forms: Answer<BookkeepingStatementFormChoicesModel> = await call(`fiscal-years/${books.fiscalYear.id}/statement-forms`, reader);
        expect(forms.status).toBe(200);
        expect(forms.body).toMatchObject({
            fiscalYearId: books.fiscalYear.id,
            balanceSheet: { applies: 'hgb.balance-sheet.micro' },
            incomeStatement: { applies: 'hgb.income-statement.micro' }
        });
        expect(forms.body.balanceSheet.forms.map(f => f.id)).toEqual(['hgb.balance-sheet', 'hgb.balance-sheet.small', 'hgb.balance-sheet.micro']);
        expect(forms.body.incomeStatement.forms[0]).toEqual({ id: 'hgb.income-statement', name: 'Income statement by the nature of expense method (§ 275 (2) HGB)' });
        expect((await call(`fiscal-years/${books.fiscalYear.id}/statement-forms`, other.admin)).status).toBe(404);

        const page: Answer<PaginationResult<JournalEntryDetailsModel>> = await call(
            `entries?page=1&limit=1&from=2026-01-15&until=2026-12-31&accountId=${accounts.bank.id}`,
            reader
        );
        expect(page.status).toBe(200);
        expect(page.body.totalAmount).toBe(2);
        expect(page.body.items.map(i => [i.entry.postingDate, i.lines.length])).toEqual([['2026-02-01T00:00:00.000Z', 2]]);
        const backwards: Answer<ErrorResponseBody> = await call('entries?page=1&limit=10&from=2026-02-01&until=2026-01-31', reader);
        expect(backwards.status).toBe(400);
        expect(JSON.stringify(backwards.body)).toContain('The until needs to be on or after the from, 2026-02-01.');
        const foreign: Answer<ErrorResponseBody> = await call(`entries?page=1&limit=10&accountId=${other.accounts.bank.id}`, reader);
        expect(foreign.status).toBe(400);
        expect(JSON.stringify(foreign.body)).toContain('needs to be an account of the books');
        expect((await call('entries?page=1&limit=101', reader)).status).toBe(400);
        expect((await call('entries?page=1&limit=10&from=yesterday', reader)).status).toBe(400);
    });

    it('answer the books of another tenant as missing', async () => {
        const books: Books = await createBooks();
        const other: Books = await createBooks();
        const posted: Answer<JournalEntryDetailsModel> = await call('entries', books.admin, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '1'));

        expect((await call(`entries/${posted.body.entry.id}`, other.admin)).status).toBe(404);
        expect((await call<PaginationResult<JournalEntryDetailsModel>>('entries?page=1&limit=10', other.admin)).body.totalAmount).toBe(0);
        expect((await call('entries', other.admin, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '1'))).status).toBe(409);
        expect((await call<BookkeepingSettingsModel>('settings', other.admin)).body.id).toBe(other.settings.id);
    });

    it('stream the export of a fiscal year as a zip archive, with its documents unless asked not to, behind its permission', async () => {
        const books: Books = await createBooks();
        const { admin, accounts } = books;
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        const operator: Caller = await createCaller([Roles.ADMIN], undefined);
        await call('posting-rule-sets', admin, 'POST', {
            fiscalYearId: books.fiscalYear.id,
            rules: {
                payablesAccountId: accounts.payables.id,
                revenueAccounts: [],
                outputTaxAccounts: [],
                inputTaxAccounts: [{ rate: 19, accountId: accounts.inputTax.id }],
                paymentDifferenceAccounts: [],
                bankAccounts: []
            }
        });
        const form: FormData = new FormData();
        form.append('file', new Blob(['%PDF-1.4 rent'], { type: 'application/pdf' }), 'rent-2026-03.pdf');
        const receipt: Answer<ExpenseReceiptModel> = await call('expense-receipts', admin, 'POST', form);
        const expense: Answer<ExpenseModel> = await call('expenses', admin, 'POST', {
            supplier: { name: 'Landlord GmbH' },
            documentNumber: 'R-2026-03',
            documentDate: new Date('2026-03-01'),
            totals: [{ rate: 19, net: '500.00', tax: '95.00' }],
            currency: 'EUR',
            accountId: accounts.rent.id,
            receiptId: receipt.body.id
        });
        await call(`expenses/${expense.body.id}/recording`, admin, 'POST');
        await call('entries', admin, 'POST', entryOf('2026-01-02', accounts.bank, accounts.capital, '1000.00'));
        const download: (caller: Caller, query?: string) => Promise<Response> = async (caller, query = '') => await fetch(
            `${baseUrl}/bookkeeping/fiscal-years/${books.fiscalYear.id}/export${query}`,
            { headers: caller.tenantId == undefined ? { 'x-api-key': caller.key } : { 'x-api-key': caller.key, 'x-tenant-id': caller.tenantId } }
        );

        const res: Response = await download(admin);

        expect([res.status, res.headers.get('content-type'), res.headers.get('content-disposition')])
            .toEqual([200, 'application/zip', expect.stringContaining('gobd-export-2026.zip')]);
        // written while it is sent, so its length is not known before
        expect([res.headers.get('content-length'), res.headers.get('transfer-encoding')]).toEqual([null, 'chunked']);
        const read: ReadExport = readExport('gobd-export-2026.zip', 'application/zip', Buffer.from(await res.arrayBuffer()));
        // without the invoicing and the bank plugin, the tables of their sources are left out
        expect([...read.tables.keys()]).toEqual([
            'fiscal-years',
            'accounts',
            'journal-entries',
            'journal-entry-lines',
            'expenses',
            'fiscal-year-statements',
            'verification',
            'verification-problems'
        ]);
        expect(read.tables.get('journal-entries')).toHaveLength(3);
        const path: string = read.tables.get('expenses')?.[1]?.at(-1) ?? '';
        expect(path).toBe(`documents/expense-receipts/${receipt.body.id}-rent-2026-03.pdf`);
        expect(read.files.get(path)?.toString()).toBe('%PDF-1.4 rent');

        const withoutDocuments: Response = await download(admin, '?documents=false');
        const readWithout: ReadExport = readExport('gobd-export-2026.zip', 'application/zip', Buffer.from(await withoutDocuments.arrayBuffer()));
        expect([...readWithout.files.keys()].filter(name => name.startsWith('documents/'))).toEqual([]);
        expect(readWithout.tables.get('expenses')?.[1]?.at(-1)).toBe('');

        expect((await download(reader)).status).toBe(403);
        // an operator reaches the books of the tenant of the fiscal year
        const operated: Response = await download(operator);
        expect(operated.status).toBe(200);
        await operated.arrayBuffer();
        // the admin of another tenant does not find it
        expect((await download((await createBooks()).admin)).status).toBe(404);
    });

    it('reach the books of every tenant with the platform permissions, in a request naming no tenant', async () => {
        const books: Books = await createBooks();
        const operator: Caller = await createCaller([Roles.ADMIN], undefined);
        const member: Caller = { ...books.admin, tenantId: undefined };
        const tenantId: string = books.admin.tenantId ?? '';

        expect((await call<BookkeepingSettingsModel>(`settings?tenantId=${tenantId}`, operator)).body.id).toBe(books.settings.id);
        const posted: Answer<JournalEntryDetailsModel> = await call(`entries?tenantId=${tenantId}`, operator, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '5'));
        expect(posted.status).toBe(200);
        expect(posted.body.entry.tenantId).toBe(tenantId);
        expect((await call<JournalEntryDetailsModel>(`entries/${posted.body.entry.id}`, operator)).body.entry.id).toBe(posted.body.entry.id);
        expect((await call<BookkeepingVerificationModel>(`verification?tenantId=${tenantId}`, operator)).body.intact).toBe(true);
        const client: string = (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Client' })).id;
        const settings: Answer<BookkeepingSettingsModel> = await call(`settings?tenantId=${client}`, operator, 'POST', { currency: 'EUR', legalForms: [] });
        expect(settings.body.tenantId).toBe(client);
        const unnamed: Answer<ErrorResponseBody> = await call('accounts', operator);
        expect(unnamed.status).toBe(400);
        expect(JSON.stringify(unnamed.body)).toContain('A request naming no tenant needs to name the tenantId of the books.');
        // answered with the reference of the file, one of the tenant
        const form: FormData = new FormData();
        form.append('file', new Blob(['%PDF-1.4 rent'], { type: 'application/pdf' }), 'rent-2026-03.pdf');
        const receipt: Answer<ExpenseReceiptModel> = await call(`expense-receipts?tenantId=${tenantId}`, operator, 'POST', form);
        expect(receipt).toMatchObject({ status: 200, body: { tenantId, file: { name: 'rent-2026-03.pdf', mimeType: 'application/pdf' } } });
        const legalForm: Answer<BookkeepingSettingsModel> = await call(`settings?tenantId=${tenantId}`, operator, 'PATCH', { legalForm: { legalForm: 'AG', validFrom: '2027-01-01' } });
        expect(legalForm).toMatchObject({ status: 200, body: { tenantId } });

        expect((await call(`settings?tenantId=${tenantId}`, member)).status).toBe(403);
        expect((await call(`settings?tenantId=${tenantId}`, member, 'PATCH', { company: { name: 'Acme Holding' } })).status).toBe(403);
        expect((await call(`entries?tenantId=${tenantId}`, member, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '5'))).status).toBe(403);
    });

    it('record each problem the check finds in the audit trail of the tenant, once a day', async () => {
        const books: Books = await createBooks();
        const posted: Answer<JournalEntryDetailsModel> = await call('entries', books.admin, 'POST', entryOf('2026-01-02', books.accounts.bank, books.accounts.capital, '1'));
        await storeOf(inject<Repository<JournalEntry>>(repositoryTokenFor(JournalEntry))).updateAll({
            where: { id: posted.body.entry.id },
            data: { text: 'Rewritten' }
        });

        expect(new ZibriBookkeepingPlugin().cronJobs).toContain(BookkeepingVerificationCronJob);
        // built by hand, as the test server runs no cron jobs
        const job: BookkeepingVerificationCronJob = new BookkeepingVerificationCronJob();
        await job.init(inject(ZIBRI_DI_TOKENS.LOGGER), inject(repositoryTokenFor(CronJobEntity)), async () => await Promise.resolve(true));
        await job.onTick();

        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        const recorded: AuditEntry[] = await inject<Repository<AuditEntry>>(repositoryTokenFor(AuditEntry)).findAll({
            where: { action: AuditAction.BOOKKEEPING_VERIFICATION },
            acrossTenants: true,
            limit: 'all'
        });
        expect(recorded.map(e => [e.tenantId, e.outcome, e.reason, e.subject])).toEqual([[books.admin.tenantId, AuditOutcome.FAILURE, AuditReason.TAMPERED, posted.body.entry.id]]);
        const verification: Answer<BookkeepingVerificationModel> = await call('verification', books.admin);
        expect(verification.body).toMatchObject({
            intact: false,
            problems: [{ entryId: posted.body.entry.id, lineId: null, reason: 'The row is not as it was written.' }]
        });
    });
});