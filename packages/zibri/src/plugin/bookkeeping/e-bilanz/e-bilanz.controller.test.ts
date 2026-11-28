import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import {
    type BookkeepingSettingsModel,
    type EBilanzContentModel,
    type EBilanzFilingModel,
    type EBilanzFindingModel,
    type EBilanzStateModel,
    type EBilanzTransmissionModel,
    type ErrorResponseBody,
    type GermanBookkeepingCompanyModel
} from 'zibri-contract';
import { createInMemoryDataSource, InMemoryDataSource, inMemoryStoreFor } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { OtpCredentials, type OtpCredentialsCreateData } from '../../../auth/2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../../auth/2fa/methods/otp/otp.two-factor-method';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { type Permission } from '../../../auth/roles/permission.type';
import { type PlatformPermission } from '../../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../../auth/strategies/api-key/api-key.model';
import { type CreatedApiKey } from '../../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider, type DiProvider } from '../../../di/models/di-provider.model';
import { InjectionToken } from '../../../di/models/injection-token.model';
import { type XmlElementNode } from '../../../document/xml-element-node.model';
import { XmlReaderUtilities } from '../../../document/xml-reader.utilities';
import { type HttpServerLimits } from '../../../http/http-server-limits.model';
import { type Newable } from '../../../types/newable.type';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { Ms } from '../../../utilities/ms';
import { BigNumber } from '../../../utilities/number.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { bookkeepingTestEntities, day, inTenant, journal, ReceiptsFileStore, receiptsFolder } from '../bookkeeping.cases';
import { BookkeepingController } from '../bookkeeping.controller';
import { ZibriBookkeepingPlugin } from '../bookkeeping.plugin';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { BookkeepingAccount, type BookkeepingAccountCreateData } from '../models/bookkeeping-account.model';
import { type FiscalYear } from '../models/fiscal-year.model';
import { ZibriBookkeepingPermissions, ZibriBookkeepingPlatformPermissions } from '../models/zibri-bookkeeping-permissions.model';
import { COMPANY, eBilanzTestEntities, eBilanzTestProviders, recordingTransmitter } from './e-bilanz.cases';
import { EBilanzController } from './e-bilanz.controller';
import { ZibriEBilanzPlugin } from './e-bilanz.plugin';
import { E_BILANZ_EXPORTER_DI_VARIANT, E_BILANZ_TRANSMITTER_DI_VARIANT, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from './e-bilanz.tokens';
import { EBilanzAccountingStandard } from './models/e-bilanz-accounting-standard.enum';
import { EBilanzFilingKind } from './models/e-bilanz-filing-kind.enum';
import { EBilanzFiling, type EBilanzFilingCreateData } from './models/e-bilanz-filing.model';
import { EBilanzTransmissionStatus } from './models/e-bilanz-transmission-status.enum';
import { EBilanzSettings } from './models/e-bilanz-settings.model';
import { ZibriEBilanzPermissions, ZibriEBilanzPlatformPermissions } from './models/zibri-e-bilanz-permissions.model';
import { XbrlEBilanzExporter } from './services/xbrl.e-bilanz-exporter';

@Controller('/bookkeeping', { versions: 'all' })
class AppBookkeepingController extends BookkeepingController {}

@Controller('/e-bilanz', { versions: 'all' })
class AppEBilanzController extends EBilanzController {}

const E_BILANZ_PERMISSIONS: Permission[] = Object.values(ZibriEBilanzPermissions);
const E_BILANZ_PLATFORM_PERMISSIONS: PlatformPermission[] = Object.values(ZibriEBilanzPlatformPermissions);
const PERMISSIONS: Permission[] = [...Object.values(ZibriBookkeepingPermissions), ...E_BILANZ_PERMISSIONS];
const PLATFORM_PERMISSIONS: PlatformPermission[] = [...Object.values(ZibriBookkeepingPlatformPermissions), ...E_BILANZ_PLATFORM_PERMISSIONS];

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    // those of the E-Bilanz alone
    { name: Roles.ADMIN, level: 'platform', permissions: E_BILANZ_PLATFORM_PERMISSIONS, description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [ZibriEBilanzPermissions.BOOKKEEPING_E_BILANZ_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';

// the exporter an application registers to download the XBRL
const xbrlExporter: DiProvider<XbrlEBilanzExporter> = {
    token: new InjectionToken<XbrlEBilanzExporter>('test.e_bilanz.xbrl_exporter'),
    useFactory: () => new XbrlEBilanzExporter(),
    variants: [E_BILANZ_EXPORTER_DI_VARIANT]
};

/**
 * The answer of a route.
 */
type Answer<T> = {
    status: number,
    body: T
};

/**
 * Who calls a route: the tenant the request names, if any, the api key it sends, and the user it acts as.
 */
type Caller = {
    tenantId: string | undefined,
    key: string,
    userId: string
};

/**
 * What `POST /fiscal-years/:id/preview` answers, as json.
 */
type PreparationAnswer = {
    content: EBilanzContentModel,
    findings: EBilanzFindingModel[]
};

/**
 * The closed fiscal year of a tenant, and its admin.
 */
type Books = {
    admin: Caller,
    fiscalYear: FiscalYear
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ApiKey, TestTenant, ...bookkeepingTestEntities, ...eBilanzTestEntities],
    repositories: defaultTestServerRepositories
});

/**
 * Starts the application of the routes, with the providers of the E-Bilanz cases given.
 * @param providers - The providers of the cases, such as all of them, or all but the transmitter.
 */
async function start(providers: DiProvider<unknown>[]): Promise<void> {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [AppBookkeepingController, AppEBilanzController],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriEBilanzPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...providers,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: PLATFORM_PERMISSIONS }, roles)
        ]
    });
    baseUrl = await server.start();
}

/**
 * Shuts the application of the routes down.
 */
async function stop(): Promise<void> {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}

/**
 * Creates a user with roles of their own and in a tenant, and an api key acting as them.
 * @param platformRoles - Their roles of their own.
 * @param tenantRole - Their role in the tenant, none when undefined.
 * @param memberOf - The tenant they are a member of, a new one by default.
 * @returns The tenant, the key and the user.
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
            name: 'e-bilanz',
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
 * Calls a route.
 * @param path - The path, such as `e-bilanz/settings`.
 * @param caller - Who calls it.
 * @param method - The method.
 * @param body - The json body, or a multipart one, none by default.
 * @param headers - Further headers, such as a one time password.
 * @returns The status and the body of the answer.
 */
async function call<T>(
    path: string,
    caller: Caller,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
    headers: Record<string, string> = {}
): Promise<Answer<T>> {
    const sent: Record<string, string> = { 'x-api-key': caller.key, ...headers };
    if (caller.tenantId != undefined) {
        sent['x-tenant-id'] = caller.tenantId;
    }
    if (body != undefined && !(body instanceof FormData)) {
        sent['content-type'] = 'application/json';
    }
    const res: Response = await fetch(`${baseUrl}/${path}`, {
        method,
        headers: sent,
        body: body == undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    });
    const text: string = await res.text();
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

/**
 * Starts the books of a new tenant with the German company through the route of the settings, posts its capital, its
 * revenue and its rent, and closes the year 2026.
 * @returns The books.
 */
async function createBooks(): Promise<Books> {
    const admin: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
    const settings: Answer<BookkeepingSettingsModel> = await call('bookkeeping/settings', admin, 'POST', {
        currency: 'EUR',
        legalForms: [{ legalForm: 'GmbH', validFrom: '2020-01-01' }],
        company: COMPANY
    });
    expect(settings.status).toBe(200);
    const fiscalYear: FiscalYear = await inTenant(admin.tenantId ?? '', async () => {
        const data: BookkeepingAccountCreateData[] = [
            { number: '1200', name: 'Bank', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.B.IV' },
            { number: '0800', name: 'Share capital', type: BookkeepingAccountType.EQUITY, statementPosition: 'equity-and-liabilities.A.I' },
            { number: '0860', name: 'Profit carried forward', type: BookkeepingAccountType.EQUITY, statementPosition: 'equity-and-liabilities.A.IV' },
            { number: '8400', name: 'Revenue 19 %', type: BookkeepingAccountType.REVENUE, statementPosition: 'income-statement.1' },
            { number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE, statementPosition: 'income-statement.8' }
        ];
        const [bank, capital, result, revenue, rent] = await inject<Repository<BookkeepingAccount, BookkeepingAccountCreateData>>(repositoryTokenFor(BookkeepingAccount))
            .createAll(data);
        const year: FiscalYear = await journal().createFiscalYear({ start: day('2026-01-01') });
        const lines: [BookkeepingAccount | undefined, BookkeepingAccount | undefined, string][] = [
            [bank, capital, '25000.00'],
            [bank, revenue, '10000.00'],
            [rent, bank, '1200.00']
        ];
        for (const [index, [debit, credit, amount]] of lines.entries()) {
            await journal().post({
                documentDate: day('2026-03-01'),
                postingDate: day('2026-03-01'),
                documentReference: `B-${index}`,
                text: 'Booked',
                lines: [
                    { accountId: debit?.id ?? '', debit: new BigNumber(amount), credit: null },
                    { accountId: credit?.id ?? '', debit: null, credit: new BigNumber(amount) }
                ]
            });
        }
        await journal().closeFiscalYear(year.id, { resultAccountId: result?.id ?? '' });
        return year;
    });
    return { admin, fiscalYear };
}

/**
 * Confirms a one time password as the second factor of a user.
 * @param userId - The id of the user.
 */
async function registerOtp(userId: string): Promise<void> {
    const repository: Repository<OtpCredentials, OtpCredentialsCreateData> = inject(repositoryTokenFor(OtpCredentials));
    const credentials: OtpCredentials = await repository.create({ secret: OTP_SECRET, userId });
    await repository.updateById(credentials.id, { confirmed: true });
}

/**
 * The certificate and its PIN as `PUT /settings/certificate` takes them.
 * @param pin - The PIN.
 * @returns The multipart body.
 */
function certificateForm(pin: string): FormData {
    const form: FormData = new FormData();
    form.append('certificate', new Blob(['pfx'], { type: 'application/x-pkcs12' }), 'acme.pfx');
    form.append('pin', pin);
    return form;
}

/**
 * Polls `GET /fiscal-years/:id` as a frontend does after sending, until a transmission is where the case waits for it.
 * @param base - The path of the fiscal year.
 * @param caller - Who polls.
 * @param transmissionId - The id of the record the send route answered.
 * @param until - Whether the transmission is where the case waits for it, by default once it has a result.
 * @returns The transmission.
 */
async function waitForResult(
    base: string,
    caller: Caller,
    transmissionId: string,
    until: (transmission: EBilanzTransmissionModel) => boolean = t => t.status !== EBilanzTransmissionStatus.TRANSMITTING
): Promise<EBilanzTransmissionModel> {
    for (let attempt: number = 0; attempt < 500; attempt++) {
        const found: EBilanzTransmissionModel | undefined = (await call<EBilanzStateModel>(base, caller)).body.transmissions.find(t => t.id === transmissionId);
        if (found != undefined && until(found)) {
            return found;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`The transmission ${transmissionId} did not get where the case waits for it.`);
}

/**
 * Prepares the E-Bilanz of new books and uploads the certificate, so that it can be sent.
 * @returns The books.
 */
async function createTransmittableBooks(): Promise<Books> {
    const books: Books = await createBooks();
    const base: string = `e-bilanz/fiscal-years/${books.fiscalYear.id}`;
    expect((await call(`${base}/preparation`, books.admin, 'POST', { accountingStandard: 'unified' })).status).toBe(200);
    expect((await call('e-bilanz/settings/certificate', books.admin, 'PUT', certificateForm('secret-pin'))).status).toBe(200);
    return books;
}

describe('the routes of the E-Bilanz', () => {
    beforeAll(async () => await start([...eBilanzTestProviders, xbrlExporter]), TestTimeouts.inMemory.start);

    afterAll(async () => await stop(), TestTimeouts.inMemory.shutdown);

    it('take the German company through the routes of the bookkeeping settings, and validate what it holds', async () => {
        const admin: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);

        const invalid: Answer<ErrorResponseBody> = await call('bookkeeping/settings', admin, 'POST', {
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: '2020-01-01' }],
            company: { ...COMPANY, taxNumber: '1121' }
        });
        expect(invalid.status).toBe(400);
        expect(JSON.stringify(invalid.body)).toContain('taxNumber');

        const created: Answer<BookkeepingSettingsModel> = await call('bookkeeping/settings', admin, 'POST', {
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: '2020-01-01' }],
            company: COMPANY
        });
        expect(created.status).toBe(200);
        expect(created.body.company).toStrictEqual(COMPANY);

        // the company is replaced whole, so the change needs all the German company requires
        const incomplete: Answer<ErrorResponseBody> = await call('bookkeeping/settings', admin, 'PATCH', { company: { ...COMPANY, legalStatus: undefined } });
        expect(incomplete.status).toBe(400);
        expect(JSON.stringify(incomplete.body)).toContain('legalStatus');

        const changed: Answer<BookkeepingSettingsModel> = await call('bookkeeping/settings', admin, 'PATCH', { company: { ...COMPANY, taxAdvisor: true } });
        expect(changed.status).toBe(200);
        const company: GermanBookkeepingCompanyModel | null | undefined = (await call<{ company?: GermanBookkeepingCompanyModel | null }>('bookkeeping/settings', admin)).body.company;
        expect(company?.taxAdvisor).toBe(true);
    });

    it('prepare the E-Bilanz with the company of the bookkeeping settings, and keep nothing on a preview', async () => {
        const { admin, fiscalYear } = await createBooks();

        const preview: Answer<PreparationAnswer> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}/preview`, admin, 'POST', { accountingStandard: 'unified' });
        expect(preview.status).toBe(200);
        expect(preview.body.findings).toStrictEqual([]);
        expect(preview.body.content.company).toStrictEqual(COMPANY);
        expect((await call<EBilanzStateModel>(`e-bilanz/fiscal-years/${fiscalYear.id}`, admin)).body.filings).toStrictEqual([]);

        const prepared: Answer<EBilanzFilingModel> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        expect(prepared.status).toBe(200);
        expect([prepared.body.kind, prepared.body.createdBy, prepared.body.content?.company.taxNumber]).toStrictEqual([EBilanzFilingKind.PREPARED, admin.userId, COMPANY.taxNumber]);
    });

    it('refuse an accounting standard it does not know, with a 400 naming those it takes', async () => {
        const { admin, fiscalYear } = await createBooks();

        const preview: Answer<ErrorResponseBody> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}/preview`, admin, 'POST', { accountingStandard: 'commercial' });
        const prepared: Answer<ErrorResponseBody> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}/preparation`, admin, 'POST', { accountingStandard: 'commercial' });

        expect([preview.status, prepared.status]).toStrictEqual([400, 400]);
        expect(JSON.stringify(preview.body)).toContain(EBilanzAccountingStandard.UNIFIED);
        expect((await call<EBilanzStateModel>(`e-bilanz/fiscal-years/${fiscalYear.id}`, admin)).body.filings).toStrictEqual([]);
    });

    it('send it as a test, and for real only after an accepted test of the same content and with a second factor given again', async () => {
        const { admin, fiscalYear } = await createBooks();
        await registerOtp(admin.userId);
        const otpHeader: string = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        const code = (): Record<string, string> => ({ [otpHeader]: new TOTP({ secret: OTP_SECRET }).generate() });
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        const prepared: Answer<EBilanzFilingModel> = await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        expect((await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('secret-pin'))).status).toBe(200);

        const sent: number = recordingTransmitter.transmissions.length;
        const test: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, admin, 'POST');
        // answered once it is started, and polled until it has a result
        expect(test.status).toBe(202);
        expect([test.body.kind, test.body.status, test.body.preparationId, test.body.contentHash, test.body.succeeded])
            .toStrictEqual([EBilanzFilingKind.TEST_TRANSMISSION, EBilanzTransmissionStatus.TRANSMITTING, prepared.body.id, prepared.body.contentHash, false]);
        const tested: EBilanzTransmissionModel = await waitForResult(base, admin, test.body.id);
        expect([tested.status, tested.result?.succeeded, tested.result?.transmissionId]).toStrictEqual([EBilanzTransmissionStatus.ACCEPTED, true, test.body.id]);
        expect(recordingTransmitter.transmissions.at(-1)).toMatchObject({ test: true, certificate: { pin: 'secret-pin' } });

        // the one route filing with the tax administration, which the key alone does not reach. The name tells a client
        // whether to ask for a code or for a new login
        const missing: Answer<ErrorResponseBody> = await call(`${base}/transmission`, admin, 'POST');
        expect([missing.status, missing.body.name]).toStrictEqual([401, 'SecondFactorMissingError']);
        const withoutFactor: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN, admin.tenantId);
        const reauth: Answer<ErrorResponseBody> = await call(`${base}/transmission`, withoutFactor, 'POST');
        expect([reauth.status, reauth.body.name]).toStrictEqual([401, 'ReauthenticationRequiredError']);
        const real: Answer<EBilanzFilingModel> = await call(`${base}/transmission`, admin, 'POST', undefined, code());
        expect([real.status, real.body.kind]).toStrictEqual([202, EBilanzFilingKind.TRANSMISSION]);
        expect((await waitForResult(base, admin, real.body.id)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
        // one call of the transmitter for each request
        expect(recordingTransmitter.transmissions.slice(sent).map(t => t.test)).toStrictEqual([true, false]);
        expect((await call<EBilanzStateModel>(base, admin)).body.filed).toBe(true);
    });

    it('settle a transmission whose result is not known only with a second factor, after which it can be sent again', async () => {
        const { admin, fiscalYear } = await createBooks();
        await registerOtp(admin.userId);
        const otpHeader: string = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        const prepared: Answer<EBilanzFilingModel> = await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('secret-pin'));
        // what an instance that stopped while sending a test leaves: its start, and no lease
        const started: EBilanzFiling = await inTenant(admin.tenantId ?? '', async () => await inject<Repository<EBilanzFiling, EBilanzFilingCreateData>>(repositoryTokenFor(EBilanzFiling))
            .create({
                fiscalYearId: fiscalYear.id,
                end: fiscalYear.end,
                kind: EBilanzFilingKind.TEST_TRANSMISSION,
                preparationId: prepared.body.id,
                contentHash: prepared.body.contentHash,
                content: null,
                input: null,
                correctsFilingId: null,
                status: EBilanzTransmissionStatus.TRANSMITTING,
                transmissionId: null,
                mayHaveBeenSent: true,
                error: null,
                succeeded: false,
                ticket: null,
                messages: [],
                protocol: null,
                createdBy: admin.userId,
                createdAt: new Date(),
                retainUntil: new Date('2040-01-01T00:00:00.000Z')
            }));

        const state: Answer<EBilanzStateModel> = await call(base, admin);
        expect(state.body.transmissions.map(t => [t.id, t.status, t.mayHaveBeenSent])).toStrictEqual([[started.id, EBilanzTransmissionStatus.UNKNOWN, true]]);
        const refused: Answer<ErrorResponseBody> = await call(`${base}/test-transmission`, admin, 'POST');
        expect([refused.status, refused.body.message]).toStrictEqual([409, expect.stringContaining('not known')]);
        const missing: Answer<ErrorResponseBody> = await call(`${base}/transmission-not-received`, admin, 'POST');
        expect([missing.status, missing.body.name]).toStrictEqual([401, 'SecondFactorMissingError']);

        const settled: Answer<EBilanzFilingModel[]> = await call(`${base}/transmission-not-received`, admin, 'POST', undefined, { [otpHeader]: new TOTP({ secret: OTP_SECRET }).generate() });
        expect([settled.status, settled.body.map(f => [f.status, f.transmissionId, f.createdBy])])
            .toStrictEqual([200, [[EBilanzTransmissionStatus.NOT_RECEIVED, started.id, admin.userId]]]);
        const again: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, admin, 'POST');
        expect(again.status).toBe(202);
        expect((await waitForResult(base, admin, again.body.id)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
    });

    it('refuse to send for real while only another content was accepted as a test', async () => {
        const { admin, fiscalYear } = await createBooks();
        await registerOtp(admin.userId);
        const otpHeader: string = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('secret-pin'));
        const test: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, admin, 'POST');
        expect((await waitForResult(base, admin, test.body.id)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);

        // prepared again with another content, whose test is still missing
        const rent: string = (await inTenant(admin.tenantId ?? '', async () => await inject<Repository<BookkeepingAccount>>(repositoryTokenFor(BookkeepingAccount))
            .findOne({ where: { number: '4210' }, required: true }))).id;
        expect((await call(`e-bilanz/account-mappings/${rent}`, admin, 'PUT', { position: 'is.netIncome.regular.operatingTC.otherCost.leaseFix.misc' })).status).toBe(200);
        expect((await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' })).status).toBe(200);

        const real: Answer<ErrorResponseBody> = await call(`${base}/transmission`, admin, 'POST', undefined, { [otpHeader]: new TOTP({ secret: OTP_SECRET }).generate() });
        expect(real.status).toBe(409);
        expect(real.body.message).toContain('as a test');
    });

    it('record a filing by hand with its protocol as a multipart upload', async () => {
        const { admin, fiscalYear } = await createBooks();
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        const form: FormData = new FormData();
        form.append('protocol', new Blob(['%PDF-1.4 protocol'], { type: 'application/pdf' }), 'transmission-protocol-2026.pdf');

        const filing: Answer<EBilanzFilingModel> = await call(`${base}/manual-filing`, admin, 'POST', form);

        expect(filing.status).toBe(200);
        expect([filing.body.kind, filing.body.protocol?.name, filing.body.protocol?.mimeType])
            .toStrictEqual([EBilanzFilingKind.MANUAL_FILING, 'transmission-protocol-2026.pdf', 'application/pdf']);
        expect((await call<EBilanzStateModel>(base, admin)).body.filed).toBe(true);
        expect((await call(`${base}/manual-filing`, admin, 'POST', new FormData())).status).toBe(400);
    });

    it('download the protocol of a record from the url of its reference, with the permission to read the records', async () => {
        const { admin, fiscalYear } = await createBooks();
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        const stranger: Caller = await createCaller([Roles.USER], MemberRoles.ADMIN);
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        const form: FormData = new FormData();
        form.append('protocol', new Blob(['%PDF-1.4 protocol'], { type: 'application/pdf' }), 'transmission-protocol-2026.pdf');
        const filing: Answer<EBilanzFilingModel> = await call(`${base}/manual-filing`, admin, 'POST', form);
        // the url starts with the baseUrl of the application, which the server of the test is not reached at
        const url: URL = new URL(filing.body.protocol?.url ?? '');
        const download = async (caller: Caller, search: string): Promise<Response> => await fetch(`${baseUrl}${url.pathname}${search}`, {
            headers: { 'x-api-key': caller.key, 'x-tenant-id': caller.tenantId ?? '' }
        });

        expect([url.pathname, url.searchParams.get('x-tenant-id')]).toStrictEqual([`/e-bilanz/${filing.body.id}/files/protocol`, admin.tenantId]);
        const state: Answer<EBilanzStateModel> = await call(base, reader);
        expect(state.body.filings.find(f => f.id === filing.body.id)?.protocol?.url).toBe(filing.body.protocol?.url);
        const res: Response = await download(reader, url.search);
        expect([res.status, res.headers.get('content-type'), await res.text()]).toStrictEqual([200, 'application/pdf', '%PDF-1.4 protocol']);
        // a record of another tenant is not there for them
        expect((await download(stranger, '')).status).toBe(404);
        expect((await call(`e-bilanz/${filing.body.id}/files/content`, admin)).status).toBe(404);
    });

    it('download the latest preparation as XBRL with the exporter registered, as a file named after the fiscal year', async () => {
        const { admin, fiscalYear } = await createBooks();
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        const download: () => Promise<Response> = async () => await fetch(`${baseUrl}/${base}/export?exporter=xbrl`, {
            headers: { 'x-api-key': admin.key, 'x-tenant-id': admin.tenantId ?? '' }
        });
        expect((await download()).status).toBe(409);
        await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });

        const state: Answer<EBilanzStateModel> = await call(base, admin);
        expect(state.body.exporters).toStrictEqual([{ name: 'xbrl', mimeType: 'application/xml', fileExtension: 'xbrl' }]);
        const res: Response = await download();

        expect([res.status, res.headers.get('content-type'), res.headers.get('content-disposition')])
            .toStrictEqual([200, 'application/xml', 'attachment; filename="e-bilanz-2026-01-01-2026-12-31.xbrl"']);
        const xml: string = await res.text();
        const root: XmlElementNode = XmlReaderUtilities.resolveRootElement(xml);
        expect([root.namespace, root.name]).toStrictEqual(['http://www.xbrl.org/2003/instance', 'xbrl']);
        expect(xml).toContain('<de-gcd:genInfo.company.id.name contextRef="duration">Acme Software GmbH</de-gcd:genInfo.company.id.name>');
        expect(xml).toContain('<de-gaap-ci:bs.ass contextRef="instant" unitRef="EUR" decimals="2">33800.00</de-gaap-ci:bs.ass>');
        expect((await call(`${base}/export?exporter=json`, admin)).status).toBe(409);
    });

    it('keep the certificate with its PIN stored encrypted, answering neither', async () => {
        const { admin, fiscalYear } = await createBooks();

        const before: Answer<EBilanzStateModel> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}`, admin);
        expect([before.body.transmitterConfigured, before.body.transmitterUnavailableReason])
            .toStrictEqual([false, 'The ELSTER certificate of the company and its PIN need to be uploaded.']);
        expect((await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('123'))).status).toBe(400);

        const uploaded: Answer<Record<string, unknown>> = await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('secret-pin'));

        expect(uploaded.status).toBe(200);
        expect(Object.keys(uploaded.body).sort()).toStrictEqual(['certificateUploadedAt', 'certificateUploadedBy']);
        expect(uploaded.body['certificateUploadedBy']).toBe(admin.userId);
        expect(JSON.stringify((await call('e-bilanz/settings', admin)).body)).not.toContain('secret-pin');
        const settings: EBilanzSettings = await inTenant(admin.tenantId ?? '', async () => await inject<Repository<EBilanzSettings>>(repositoryTokenFor(EBilanzSettings))
            .findOne({ required: true }));
        const stored: unknown = inMemoryStoreFor(dataSourceClass).readRow(MetadataUtilities.getEntityMetadata(EBilanzSettings)?.tableName ?? '', settings.id)?.['certificatePin'];
        expect([settings.certificatePin, typeof stored, stored === 'secret-pin']).toStrictEqual(['secret-pin', 'string', false]);
        const after: Answer<EBilanzStateModel> = await call(`e-bilanz/fiscal-years/${fiscalYear.id}`, admin);
        expect([after.body.transmitterConfigured, after.body.transmitterUnavailableReason]).toStrictEqual([true, null]);
    });

    it('answer each route with the permission it needs', async () => {
        const { admin, fiscalYear } = await createBooks();
        const reader: Caller = await createCaller([Roles.USER], MemberRoles.USER, admin.tenantId);
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        const mapping: { position: string } = { position: 'is.netIncome.regular.operatingTC.otherCost.leaseFix.misc' };

        expect((await call(base, reader)).status).toBe(200);
        expect((await call(`${base}/preview`, reader, 'POST', { accountingStandard: 'unified' })).status).toBe(200);
        expect((await call('e-bilanz/settings', reader)).status).toBe(200);
        expect((await call('e-bilanz/account-mappings', reader)).status).toBe(200);
        expect((await call(`${base}/preparation`, reader, 'POST', { accountingStandard: 'unified' })).status).toBe(403);
        expect((await call(`${base}/export?exporter=json`, reader)).status).toBe(403);
        expect((await call(`${base}/test-transmission`, reader, 'POST')).status).toBe(403);
        expect((await call(`${base}/transmission-not-received`, reader, 'POST')).status).toBe(403);
        expect((await call(`${base}/manual-filing`, reader, 'POST', new FormData())).status).toBe(403);
        expect((await call('e-bilanz/settings/certificate', reader, 'PUT', certificateForm('secret-pin'))).status).toBe(403);
        expect((await call(`e-bilanz/account-mappings/${UUIDUtilities.generate()}`, reader, 'PUT', mapping)).status).toBe(403);
        expect((await call(`e-bilanz/account-mappings/${UUIDUtilities.generate()}`, reader, 'DELETE')).status).toBe(403);
    });

    it('reach the E-Bilanz of every tenant with the platform permissions, in a request naming no tenant', async () => {
        const { admin, fiscalYear } = await createBooks();
        const platform: Caller = await createCaller([Roles.ADMIN], undefined);
        const nobody: Caller = await createCaller([Roles.USER], undefined);
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;

        expect((await call<EBilanzStateModel>(base, platform)).body.fiscalYearId).toBe(fiscalYear.id);
        expect((await call(base, nobody)).status).toBe(403);
        expect((await call<EBilanzFilingModel>(`${base}/preparation`, platform, 'POST', { accountingStandard: 'unified' })).body.kind).toBe(EBilanzFilingKind.PREPARED);
        expect((await call(`${base}/preparation`, nobody, 'POST', { accountingStandard: 'unified' })).status).toBe(403);
        expect((await call<EBilanzFilingModel>(`${base}/test-transmission`, platform, 'POST')).status).toBe(409);
        expect((await call(`${base}/test-transmission`, nobody, 'POST')).status).toBe(403);
        // a route naming no fiscal year takes the tenant by its id
        expect((await call('e-bilanz/settings', platform)).status).toBe(400);
        expect((await call(`e-bilanz/settings?tenantId=${admin.tenantId}`, platform)).status).toBe(200);
        expect((await call(`e-bilanz/settings/certificate?tenantId=${admin.tenantId}`, platform, 'PUT', certificateForm('secret-pin'))).status).toBe(200);
        expect((await call(`e-bilanz/settings/certificate?tenantId=${admin.tenantId}`, nobody, 'PUT', certificateForm('secret-pin'))).status).toBe(403);
        // answered with the reference of its protocol, a file of the tenant
        const tested: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, platform, 'POST');
        expect([tested.status, tested.body.kind]).toStrictEqual([202, EBilanzFilingKind.TEST_TRANSMISSION]);
        // the result, recorded in the tenant of the fiscal year
        const result: EBilanzTransmissionModel = await waitForResult(base, platform, tested.body.id);
        expect([result.status, result.result?.protocol?.name]).toStrictEqual([EBilanzTransmissionStatus.ACCEPTED, 'protocol.pdf']);
        const state: Answer<EBilanzStateModel> = await call(base, platform);
        expect([state.status, state.body.filings.find(f => f.id === result.result?.id)?.protocol?.name]).toStrictEqual([200, 'protocol.pdf']);
        const form: FormData = new FormData();
        form.append('protocol', new Blob(['%PDF-1.4 protocol'], { type: 'application/pdf' }), 'transmission-protocol-2026.pdf');
        const filed: Answer<EBilanzFilingModel> = await call(`${base}/manual-filing`, platform, 'POST', form);
        expect([filed.status, filed.body.kind, filed.body.protocol?.name])
            .toStrictEqual([200, EBilanzFilingKind.MANUAL_FILING, 'transmission-protocol-2026.pdf']);
    });
});

describe('the routes of the E-Bilanz with a transmitter slower than the deadline of a request', () => {
    // a deadline far below what a transmitter automating another program takes
    const limits: HttpServerLimits = {
        requestTimeoutInMs: Ms.SECOND * 60,
        headersTimeoutInMs: Ms.SECOND * 15,
        keepAliveTimeoutInMs: Ms.SECOND * 75,
        handlerTimeoutInMs: 300,
        maxHeaderCount: 100,
        maxHeaderSizeInBytes: 16 * 1024,
        maxBodySizes: { json: '100kb', xml: '100kb', formUrlEncoded: '100kb', formData: '100kb', stream: '10mb' }
    };

    beforeAll(async () => await start([
        ...eBilanzTestProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS, useValue: limits }),
        defineProvider({ token: ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { transmissionTimeoutInMs: 1500 } })
    ]), TestTimeouts.inMemory.start);

    afterEach(() => recordingTransmitter.answerAccepted());

    afterAll(async () => await stop(), TestTimeouts.inMemory.shutdown);

    it('record the result of a transmission that takes longer than the deadline', async () => {
        const { admin, fiscalYear } = await createTransmittableBooks();
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        recordingTransmitter.answer = async () => {
            await new Promise(resolve => setTimeout(resolve, 900));
            return await recordingTransmitter.resolveAccepted();
        };

        const started: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, admin, 'POST');

        expect([started.status, started.body.status]).toStrictEqual([202, EBilanzTransmissionStatus.TRANSMITTING]);
        const transmission: EBilanzTransmissionModel = await waitForResult(base, admin, started.body.id);
        expect([transmission.status, transmission.result?.ticket]).toStrictEqual([EBilanzTransmissionStatus.ACCEPTED, `ticket-${recordingTransmitter.transmissions.length}`]);
        // and the test it was counts for the transmission for real
        expect((await call<EBilanzStateModel>(base, admin)).body.filings.filter(f => f.kind === EBilanzFilingKind.TEST_TRANSMISSION && f.succeeded)).toHaveLength(1);
    });

    it('record a transmission that outlasts its timeout as unknown, abort its signal, and record what it answers later', async () => {
        const { admin, fiscalYear } = await createTransmittableBooks();
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        let signal: AbortSignal | undefined;
        recordingTransmitter.answer = async options => {
            signal = options.signal;
            // answers only once it is told to stop, as a program that was sending already does
            await new Promise(resolve => options.signal.addEventListener('abort', resolve));
            await new Promise(resolve => setTimeout(resolve, 300));
            return await recordingTransmitter.resolveAccepted();
        };

        const started: Answer<EBilanzFilingModel> = await call(`${base}/test-transmission`, admin, 'POST');

        const unknown: EBilanzTransmissionModel = await waitForResult(base, admin, started.body.id);
        expect([unknown.status, unknown.mayHaveBeenSent, unknown.result?.error?.name, signal?.aborted])
            .toStrictEqual([EBilanzTransmissionStatus.UNKNOWN, true, 'EBilanzTransmissionTimeoutError', true]);
        const late: EBilanzTransmissionModel = await waitForResult(base, admin, started.body.id, t => t.status !== EBilanzTransmissionStatus.UNKNOWN);
        expect(late.status).toBe(EBilanzTransmissionStatus.ACCEPTED);
        // both results stay on record
        expect((await call<EBilanzStateModel>(base, admin)).body.filings.filter(f => f.transmissionId === started.body.id).map(f => f.status))
            .toStrictEqual([EBilanzTransmissionStatus.UNKNOWN, EBilanzTransmissionStatus.ACCEPTED]);
    });
});

describe('the routes of the E-Bilanz without a transmitter', () => {
    beforeAll(async () => await start(eBilanzTestProviders.filter(p => !(p.variants ?? []).includes(E_BILANZ_TRANSMITTER_DI_VARIANT))), TestTimeouts.inMemory.start);

    afterAll(async () => await stop(), TestTimeouts.inMemory.shutdown);

    it('say that no transmitter is registered and how to enable one, and refuse to send', async () => {
        const { admin, fiscalYear } = await createBooks();
        const base: string = `e-bilanz/fiscal-years/${fiscalYear.id}`;
        await call(`${base}/preparation`, admin, 'POST', { accountingStandard: 'unified' });
        await call('e-bilanz/settings/certificate', admin, 'PUT', certificateForm('secret-pin'));

        const state: Answer<EBilanzStateModel> = await call(base, admin);
        expect([state.body.transmitterConfigured, state.body.transmitterUnavailableReason]).toStrictEqual([
            false,
            'No transmitter is registered: provide an EBilanzTransmitterInterface with E_BILANZ_TRANSMITTER_DI_VARIANT, or file an export by hand and record it.'
        ]);
        expect((await call(`${base}/test-transmission`, admin, 'POST')).status).toBe(409);
    });
});
