/* eslint-disable cspell/spellchecker */
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type ErrorResponseBody, type InvoiceModel, type PaginationResult } from 'zibri-contract';
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
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { InvoiceDocumentsFileStore, invoiceArchiveTestEntities, invoiceArchiveTestProviders, invoiceDocumentsFolder } from './invoicing.archive.cases';
import { InvoicingController } from './invoicing.controller';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceAddress } from './models/invoice-address.model';
import { type InvoiceDocument } from './models/invoice-document.model';
import { Invoice } from './models/invoice.model';
import { ZibriInvoicingPermissions, ZibriInvoicingPlatformPermissions } from './models/zibri-invoicing-permissions.model';

// the routes of the invoices, as an application registers them, archiving each invoice as an XRechnung but those of
// a customer of a pdf alone, and with no payment source

@Controller('/invoicing', { versions: 'all' })
class AppInvoicingController extends InvoicingController {}

const PERMISSIONS: Permission[] = Object.values(ZibriInvoicingPermissions);
const PLATFORM_PERMISSIONS: PlatformPermission[] = Object.values(ZibriInvoicingPlatformPermissions);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: PLATFORM_PERMISSIONS, description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: PERMISSIONS, description: undefined }
];

/**
 * Who calls a route: the tenant the request names, if any, and the api key it sends.
 */
type Caller = {
    tenantId: string | undefined,
    key: string
};

/**
 * The answer of a route, with its body as json, and as it was sent.
 */
type Answer<T> = {
    status: number,
    contentType: string | null,
    body: T,
    bytes: Buffer
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [InvoiceDocumentsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ApiKey, TestTenant, ...invoiceArchiveTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        controllers: [AppInvoicingController],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...invoiceArchiveTestProviders,
            ...rolesAndPermissionsProviders({ permissions: PERMISSIONS, platformPermissions: PLATFORM_PERMISSIONS }, roles)
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(invoiceDocumentsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Creates a user with roles of their own and in a tenant, and an api key acting as them.
 * @param platformRole - Their role of their own.
 * @param tenantRole - Their role in the tenant, none when undefined.
 * @param memberOf - The tenant they are a member of, a new one by default.
 * @returns The tenant and the key.
 */
async function createCaller(platformRole: Roles, tenantRole: MemberRoles | undefined, memberOf?: string): Promise<Caller> {
    const tenantId: string | undefined = tenantRole == undefined
        ? undefined
        : memberOf ?? (await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: 'Acme' })).id;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@example.com`, roles: [platformRole] });
    if (tenantId != undefined && tenantRole != undefined) {
        await inTenant(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [tenantRole] }));
    }
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        {
            name: 'invoicing',
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

async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * Calls a route of the invoices.
 * @param path - The path below the invoicing, such as `invoices`.
 * @param caller - Who calls it.
 * @returns The answer.
 */
async function call<T>(path: string, caller: Caller): Promise<Answer<T>> {
    const headers: Record<string, string> = { 'x-api-key': caller.key };
    if (caller.tenantId != undefined) {
        headers['x-tenant-id'] = caller.tenantId;
    }
    const res: Response = await fetch(`${baseUrl}/invoicing/${path}`, { headers });
    const bytes: Buffer = Buffer.from(await res.arrayBuffer());
    const contentType: string | null = res.headers.get('content-type');
    const json: boolean = contentType?.includes('json') === true;
    return { status: res.status, contentType, body: (json ? JSON.parse(bytes.toString()) : undefined) as T, bytes };
}

/**
 * Creates an invoice of 1,000.00 at 19 % of a company with an email, as an XRechnung names it.
 * @param tenantId - The tenant.
 * @param number - Its number.
 * @param data - What differs, such as that it is issued.
 * @returns The invoice.
 */
async function createInvoice(tenantId: string, number: string, data: Partial<Invoice> = {}): Promise<Invoice> {
    const customer: InvoiceAddress = {
        formOfAddress: '',
        firstName: '',
        lastName: '',
        street: 'Great Street',
        number: '42',
        postcode: '12345',
        city: 'Great City',
        company: true,
        companyName: 'Great Company',
        countryId: 'DE',
        email: 'info@great-company-llc.com'
    };
    return await inTenant(tenantId, async () => await inject<Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>>(repositoryTokenFor(Invoice)).create({
        number,
        currency: 'EUR',
        items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 1000 }],
        date: new Date('2026-03-01T12:00:00.000Z'),
        performanceDate: new Date('2026-03-01T12:00:00.000Z'),
        dueDate: new Date('2026-03-15T12:00:00.000Z'),
        customerAddressData: customer,
        textBeforeItems: [],
        textAfterItems: [],
        ...data
    }));
}

describe('the routes of the invoices', () => {
    it('list the invoices of the tenant, read one, and answer its archived pdf and electronic invoice', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const tenantId: string = reader.tenantId ?? '';
        const issued: Invoice = await createInvoice(tenantId, '2026-GREATC-0001', { issuedAt: new Date() });
        await createInvoice(tenantId, 'TEMP-2026-GREATC-0002', { date: new Date('2026-03-02T12:00:00.000Z') });

        const all: Answer<PaginationResult<InvoiceModel>> = await call('invoices?page=1&limit=10', reader);
        const drafts: Answer<PaginationResult<InvoiceModel>> = await call('invoices?page=1&limit=10&issued=false', reader);
        const found: Answer<PaginationResult<InvoiceModel>> = await call('invoices?page=1&limit=10&search=greatc-0001&type=INVOICE', reader);
        const one: Answer<InvoiceModel> = await call(`invoices/${issued.id}`, reader);

        expect([all.status, all.body.totalAmount, all.body.items.map(i => i.number)]).toEqual([200, 2, ['TEMP-2026-GREATC-0002', '2026-GREATC-0001']]);
        expect(drafts.body.items.map(i => i.number)).toEqual(['TEMP-2026-GREATC-0002']);
        expect(found.body.items.map(i => i.id)).toEqual([issued.id]);
        expect(one.body).toMatchObject({ id: issued.id, number: '2026-GREATC-0001', tenantId, type: 'INVOICE' });

        // the bytes archived at its issue
        const archived: InvoiceDocument | undefined = await inTenant(
            tenantId,
            async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE).findDocument(issued.id)
        );
        if (archived == undefined) {
            throw new Error('The issued invoice is not archived.');
        }
        const pdf: Answer<unknown> = await call(`invoices/${issued.id}/pdf`, reader);
        expect([pdf.status, pdf.contentType]).toEqual([200, 'application/pdf']);
        expect(pdf.bytes.equals(await inTenant(tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(archived.pdf)))).toBe(true);
        const xml: Answer<unknown> = await call(`invoices/${issued.id}/electronic-invoice`, reader);
        expect(xml.status).toBe(200);
        expect(xml.contentType).toContain('xml');
        const archivedXml: Buffer = await inTenant(
            tenantId,
            async () => await buffer(await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(archived, archived.electronicInvoice ?? ''))
        );
        expect(xml.bytes.equals(archivedXml)).toBe(true);
    });

    it('render the pdf and the electronic invoice of a draft, and answer a 404 for an invoice archived as a pdf alone', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const tenantId: string = reader.tenantId ?? '';
        const draft: Invoice = await createInvoice(tenantId, 'TEMP-2026-GREATC-0001');
        const paperOnly: Invoice = await createInvoice(tenantId, '2026-PAPERO-0001', {
            issuedAt: new Date(),
            customerAddressData: { ...draft.customerAddressData, companyName: 'Paper Only LLC' }
        });

        const pdf: Answer<unknown> = await call(`invoices/${draft.id}/pdf`, reader);
        const xml: Answer<unknown> = await call(`invoices/${draft.id}/electronic-invoice`, reader);
        const none: Answer<ErrorResponseBody> = await call(`invoices/${paperOnly.id}/electronic-invoice`, reader);

        expect([pdf.status, pdf.bytes.subarray(0, 5).toString()]).toEqual([200, '%PDF-']);
        expect([xml.status, xml.bytes.toString()]).toEqual([200, expect.stringContaining('TEMP-2026-GREATC-0001')]);
        expect([none.status, none.body.message]).toEqual([404, 'The invoice 2026-PAPERO-0001 has no electronic invoice.']);
        expect((await call(`invoices/${paperOnly.id}/pdf`, reader)).status).toBe(200);
    });

    it('preview the electronic invoice of a draft in the conformance named, and answer an archived one as it was archived', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const tenantId: string = reader.tenantId ?? '';
        const issued: Invoice = await createInvoice(tenantId, '2026-GREATC-0001', { issuedAt: new Date() });
        const draft: Invoice = await createInvoice(tenantId, 'TEMP-2026-GREATC-0002');
        // a customer the archive writes a pdf alone for
        const paperDraft: Invoice = await createInvoice(tenantId, 'TEMP-2026-PAPERO-0001', {
            customerAddressData: { ...draft.customerAddressData, companyName: 'Paper Only LLC' }
        });

        const named: Answer<unknown> = await call(`invoices/${paperDraft.id}/electronic-invoice?conformance=x-rechnung`, reader);
        const missing: Answer<ErrorResponseBody> = await call(`invoices/${paperDraft.id}/electronic-invoice`, reader);
        const unknown: Answer<ErrorResponseBody> = await call(`invoices/${draft.id}/electronic-invoice?conformance=zugferd`, reader);
        const archived: Answer<unknown> = await call(`invoices/${issued.id}/electronic-invoice?conformance=zugferd`, reader);

        expect([named.status, named.bytes.toString()]).toEqual([200, expect.stringContaining('TEMP-2026-PAPERO-0001')]);
        expect([missing.status, missing.body.message]).toEqual([400, 'The conformance needs to be one of x-rechnung, peppol.']);
        expect([unknown.status, unknown.body.message]).toEqual([400, 'The conformance needs to be one of x-rechnung, peppol.']);
        expect([archived.status, archived.bytes.toString()]).toEqual([200, expect.stringContaining('2026-GREATC-0001')]);
    });

    it('refuse a member without the permission, and find no invoice of another tenant', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const member: Caller = await createCaller(Roles.USER, MemberRoles.USER, reader.tenantId);
        const stranger: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const invoice: Invoice = await createInvoice(reader.tenantId ?? '', '2026-GREATC-0001', { issuedAt: new Date() });

        expect((await call('invoices?page=1&limit=10', member)).status).toBe(403);
        expect((await call(`invoices/${invoice.id}`, member)).status).toBe(403);
        for (const path of [`invoices/${invoice.id}`, `invoices/${invoice.id}/pdf`, `invoices/${invoice.id}/electronic-invoice`]) {
            expect((await call(path, stranger)).status).toBe(404);
        }
        expect((await call<PaginationResult<InvoiceModel>>('invoices?page=1&limit=10', stranger)).body.totalAmount).toBe(0);
    });

    it('reach the invoices of every tenant with the platform permission, the list naming the tenant', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);
        const invoice: Invoice = await createInvoice(reader.tenantId ?? '', '2026-GREATC-0001', { issuedAt: new Date() });
        const platform: Caller = await createCaller(Roles.ADMIN, undefined);
        const nobody: Caller = await createCaller(Roles.USER, undefined);

        const unnamed: Answer<ErrorResponseBody> = await call('invoices?page=1&limit=10', platform);
        const named: Answer<PaginationResult<InvoiceModel>> = await call(`invoices?page=1&limit=10&tenantId=${reader.tenantId}`, platform);

        expect([unnamed.status, unnamed.body.message]).toEqual([400, 'A request naming no tenant needs to name the tenantId of the invoices.']);
        expect(named.body.items.map(i => i.id)).toEqual([invoice.id]);
        expect((await call<InvoiceModel>(`invoices/${invoice.id}`, platform)).body.number).toBe('2026-GREATC-0001');
        expect((await call(`invoices/${invoice.id}/pdf`, platform)).status).toBe(200);
        expect((await call(`invoices/${invoice.id}`, nobody)).status).toBe(403);
    });

    it('refuse open without a payment source, and a type it does not know, with a 400 saying what they need to be', async () => {
        const reader: Caller = await createCaller(Roles.USER, MemberRoles.ADMIN);

        const open: Answer<ErrorResponseBody> = await call('invoices?page=1&limit=10&open=true', reader);
        const type: Answer<ErrorResponseBody> = await call('invoices?page=1&limit=10&type=RECEIPT', reader);

        expect([open.status, open.body.message]).toEqual([
            400,
            'The filter open needs a payment source of the invoices, such as the bank plugin with matching, which this application does not have.'
        ]);
        expect(type.status).toBe(400);
        expect(JSON.stringify(type.body)).toContain('CREDIT_NOTE');
    });
});