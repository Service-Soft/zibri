import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { Invoice } from './models/invoice.model';
import { NumberInvoices } from './models/number-invoices.model';
import { InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { InvoiceNumberService } from './services/invoice-number.service';

// an application keeping its issued invoices as they were sent, with issuedInvoicesReadOnly: drafted under a
// temporary number, issued with its final number, and corrected by a credit note from then on. In memory, as the
// rule holds on every data source the same way

/**
 * The tenant the invoices are issued in.
 */
const TEAM: string = UUIDUtilities.generate();

const customer: InvoiceAddress = {
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

let server: StartedTestServer | undefined;
let invoices: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>;

/**
 * Runs the given work in the tenant of the tests.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TEAM, fn);
}

/**
 * Drafts an invoice to the customer, under a temporary number.
 * @returns The draft.
 */
async function draftInvoice(): Promise<Invoice> {
    return await inTeam(async () => await invoices.create({
        number: await inject(InvoiceNumberService).generateTemporaryInvoiceNumber('siemens', customer),
        currency: 'EUR',
        items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }],
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: customer,
        textBeforeItems: [],
        textAfterItems: []
    }));
}

/**
 * Issues a draft: gives it its final number, and the moment it is issued.
 * @param draft - The draft.
 * @returns The invoice.
 */
async function issue(draft: Invoice): Promise<Invoice> {
    return await inTeam(async () => await invoices.updateById(draft.id, {
        number: await inject(InvoiceNumberService).generateInvoiceNumber('siemens', customer, undefined),
        issuedAt: new Date()
    }));
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation], repositories: defaultTestServerRepositories })],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { issuedInvoicesReadOnly: true } }),
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example-company.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
            }))
        ]
    });
    invoices = inject(repositoryTokenFor(Invoice));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('an issued invoice, with issuedInvoicesReadOnly', () => {
    it('is changed and deleted as a draft, and issued with its final number', async () => {
        const draft: Invoice = await draftInvoice();
        await inTeam(async () => await invoices.updateById(draft.id, { textAfterItems: ['Thank you for your order'] }));

        const issued: Invoice = await issue(draft);
        const other: Invoice = await draftInvoice();
        await inTeam(async () => await invoices.deleteById(other.id));

        expect(issued.issuedAt).toBeInstanceOf(Date);
        expect(issued.textAfterItems).toEqual(['Thank you for your order']);
    });

    it('cannot be changed or deleted once issued', async () => {
        const issued: Invoice = await issue(await draftInvoice());
        const message: string = `The invoice ${issued.number} is issued, and cannot be changed or deleted. A credit note corrects it.`;

        await expect(inTeam(async () => await invoices.updateById(issued.id, { dueDate: new Date(0) }))).rejects.toThrow(message);
        await expect(inTeam(async () => await invoices.updateById(issued.id, { issuedAt: null }))).rejects.toThrow(message);
        await expect(inTeam(async () => await invoices.deleteById(issued.id))).rejects.toThrow(message);
        await expect(inTeam(async () => await invoices.deleteAll({ id: issued.id }))).rejects.toThrow(message);
        expect(await inTeam(async () => await invoices.findById(issued.id))).toEqual(issued);
    });

    it('is corrected by a credit note, which is issued and read only as well', async () => {
        const issued: Invoice = await issue(await draftInvoice());
        const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
        );

        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(issued.id));

        await expect(inTeam(async () => await invoices.deleteById(creditNote.id))).rejects.toThrow(
            `The invoice ${creditNote.number} is issued, and cannot be changed or deleted. A credit note corrects it.`
        );
    });
});