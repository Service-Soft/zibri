/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { CompanyInfo } from './models/company-info.model';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { Invoice } from './models/invoice.model';
import { NumberInvoices } from './models/number-invoices.model';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service';
import { InvoiceNumberService } from './services/invoice-number.service';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

const ACME: string = UUIDUtilities.generate();
const GLOBEX: string = UUIDUtilities.generate();

/**
 * The company a tenant issues its invoices as, named after it.
 * @param name - The name of the company.
 * @returns The company.
 */
function companyNamed(name: string): CompanyInfo {
    return {
        name,
        fullName: `${name} LLC`,
        email: `info@${name.toLowerCase()}.test`,
        phone: '12345 67890123',
        address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
        taxNumber: '123/456/78910',
        ceo: 'James Smith',
        iban: 'DE75 5121 0800 1245 1261 99',
        bic: 'ABCD5F'
    };
}

const customer: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'great company llc',
    countryId: 'DE',
    email: 'info@great-company-llc.com'
};

let server: StartedTestServer | undefined;

/**
 * Runs the given work in a tenant.
 * @param tenantId - The tenant.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

/**
 * Issues an invoice to the customer in the active tenant, numbered by the plugin.
 * @returns The invoice.
 */
async function issueInvoice(): Promise<Invoice> {
    const number: string = await inject(InvoiceNumberService).generateInvoiceNumber('customer', customer, undefined);
    const invoices: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> = inject(repositoryTokenFor(Invoice));
    return await invoices.create({
        number,
        currency: 'EUR',
        items: [
            {
                name: 'Testing',
                amount: 4,
                amountUnit: { displayName: 'Hours', code: 'HUR' },
                vat: { categoryCode: 'E', rate: 0, exemptionReason: '§19 small business' },
                price: 90
            }
        ],
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: customer,
        textBeforeItems: [''],
        textAfterItems: ['']
    });
}

describe('invoicing across tenants', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
            plugins: [new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                companyInfoProvider(tenantId => companyNamed(tenantId === ACME ? 'Acme' : 'Globex'))
            ]
        });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('numbers the invoices of each tenant on their own', async () => {
        const ofAcme: Invoice = await inTenant(ACME, issueInvoice);
        const ofGlobex: Invoice = await inTenant(GLOBEX, issueInvoice);
        const secondOfAcme: Invoice = await inTenant(ACME, issueInvoice);

        const year: number = new Date().getFullYear();
        expect([ofAcme.number, ofGlobex.number, secondOfAcme.number])
            .toEqual([`${year}-GREATC-0001`, `${year}-GREATC-0001`, `${year}-GREATC-0002`]);
        expect([ofAcme.tenantId, ofGlobex.tenantId]).toEqual([ACME, GLOBEX]);
    });

    it('names the company of the invoice\'s own tenant as the seller, whichever tenant asks', async () => {
        const ofAcme: Invoice = await inTenant(ACME, issueInvoice);

        const xml: string = await inTenant(GLOBEX, async () => await inject(XRechnungConformanceService).generateXml(ofAcme, 'UTC'));

        expect(xml).toContain('Acme LLC');
        expect(xml).not.toContain('Globex LLC');
    });
});