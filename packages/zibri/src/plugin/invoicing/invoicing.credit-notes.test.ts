/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PdfDocument, PdfDocumentDefinition } from '../../document/pdf.utilities';
import { XmlUtilities } from '../../document/xml.utilities';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceItem } from './models/invoice-item.model';
import { type InvoicePaymentState } from './models/invoice-payment-state.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { NumberInvoices } from './models/number-invoices.model';
import { CiiCrossIndustryInvoice } from './services/conformance/en16931/cii/cii-cross-industry-invoice.model';
import { PeppolConformanceService } from './services/conformance/en16931/peppol-conformance.service';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service';
import { InvoiceCalcServiceInterface } from './services/invoice-calc-service.interface';
import { InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicePdfService } from './services/invoice-pdf.service';

// cancelling an invoice and crediting part of it, as an application does: invoices numbered by the
// plugin and stored, credit notes created by the cancellation service, written as a pdf and as
// electronic invoices. In memory, as nothing here depends on where invoices are stored. Whether a
// validator accepts the documents is en16931-conformance.kosit.heavy.test.ts's

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
    countryId: 'DE',
    email: 'invoices@siemens.example.com',
    electronicAddress: { scheme: '9930', value: 'DE987654321' }
};

/**
 * Renders the pdf of an invoice as the definition it lays out, for what it says.
 */
@Injectable({ register: 'onUse' })
class InvoicePdfDefinitionService extends InvoicePdfService {
    /**
     * Resolves the definition of the pdf of an invoice.
     * @param invoice - The invoice.
     * @returns The definition.
     */
    async resolveDefinition(invoice: Invoice): Promise<PdfDocumentDefinition> {
        return await this.generateInvoiceDocumentDefinition(invoice, undefined, 'en-US', 'UTC');
    }
}

let server: StartedTestServer | undefined;
let invoices: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>;
let cancellations: InvoiceCancellationServiceInterface<Invoice>;

/**
 * Runs the given work in the tenant of the tests.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TEAM, fn);
}

/**
 * An item, a new object for its VAT each time, as items read from a data source are.
 * @param price - Its price.
 * @param amount - How many of it.
 * @param rate - Its VAT rate.
 * @returns The item.
 */
function itemOf(price: number, amount: number = 1, rate: number = 19): InvoiceItem {
    return { name: 'Consulting', amount, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate }, price };
}

/**
 * Issues an invoice of the given items to the customer, numbered by the plugin.
 * @param items - Its items.
 * @returns The invoice.
 */
async function issueInvoice(items: InvoiceItem[]): Promise<Invoice> {
    return await inTeam(async () => {
        const number: string = await inject(InvoiceNumberService).generateInvoiceNumber('siemens', customer, undefined);
        return await invoices.create({
            number,
            currency: 'EUR',
            items,
            date: new Date(Date.UTC(2026, 9, 16)),
            performanceDate: new Date(Date.UTC(2026, 9, 15)),
            dueDate: new Date(Date.UTC(2026, 9, 30)),
            customerAddressData: customer,
            textBeforeItems: [],
            textAfterItems: [],
            issuedAt: new Date()
        });
    });
}

/**
 * The totals of an invoice: before tax, its tax and after tax.
 * @param invoice - The invoice.
 * @returns The totals, as fixed point numbers.
 */
async function totalsOf(invoice: Invoice): Promise<string[]> {
    const calc: InvoiceCalcServiceInterface<Invoice> = inject<InvoiceCalcServiceInterface<Invoice>>(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE);
    return [await calc.getTotalBeforeTax(invoice), await calc.getTotalTax(invoice), await calc.getTotalAfterTax(invoice)].map(t => t.toFixed(2));
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation], repositories: defaultTestServerRepositories })],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example-company.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                taxNumber: '123/456/78910',
                vatNumber: 'DE123456789',
                electronicAddress: { scheme: '9930', value: 'DE123456789' },
                ceo: 'James Smith',
                iban: 'DE75512108001245126199',
                bic: 'ABCDDEFFXXX'
            }))
        ]
    });
    invoices = inject(repositoryTokenFor(Invoice));
    cancellations = inject<InvoiceCancellationServiceInterface<Invoice>>(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('cancelling an invoice', () => {
    it('creates a credit note of its items and totals, referencing its number and date, numbered after it', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(90, 4), itemOf(10.05, 1, 7)]);

        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(invoice.id));

        expect(creditNote).toMatchObject({
            type: InvoiceType.CREDIT_NOTE,
            number: `${invoice.number}-C1`,
            items: invoice.items,
            currency: invoice.currency,
            customerAddressData: invoice.customerAddressData,
            precedingInvoices: [{ number: invoice.number, date: invoice.date }]
        });
        expect(creditNote.issuedAt).toBeInstanceOf(Date);
        expect(await totalsOf(creditNote)).toEqual(await totalsOf(invoice));
        expect(await totalsOf(creditNote)).toEqual(['370.05', '69.10', '439.15']);
    });

    it('refuses a second cancellation, since nothing of the invoice is left to credit', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        await inTeam(async () => await cancellations.cancelInvoice(invoice.id));

        await expect(inTeam(async () => await cancellations.cancelInvoice(invoice.id))).rejects.toThrow(
            `A credit note of the invoice ${invoice.number} needs to credit at most 0.00 EUR before tax at the VAT S 19 %, the part not yet credited.`
        );
    });

    it('reads an invoice stored without a type as an invoice', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);

        expect(invoice.type).toBe(InvoiceType.INVOICE);
        expect(invoice.precedingInvoices ?? []).toEqual([]);
    });
});

describe('crediting a part of an invoice', () => {
    it('numbers each credit note of an invoice after it, and refuses one above what is not yet credited', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);

        const first: Invoice = await inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(40)]));
        await expect(inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(70)]))).rejects.toThrow(
            `A credit note of the invoice ${invoice.number} needs to credit at most 60.00 EUR before tax at the VAT S 19 %, the part not yet credited.`
        );
        const second: Invoice = await inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(60)]));

        expect([first.number, second.number]).toEqual([`${invoice.number}-C1`, `${invoice.number}-C2`]);
        expect(await totalsOf(second)).toEqual(['60.00', '11.40', '71.40']);
    });

    it('refuses to credit tax at a rate the invoice did not charge', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);

        await expect(inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(10, 1, 7)]))).rejects.toThrow(
            `A credit note of the invoice ${invoice.number} needs to credit at most 0.00 EUR before tax at the VAT S 7 %, the part not yet credited.`
        );
    });

    it('refuses to credit a credit note or a draft', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(invoice.id));
        const draft: Invoice = await inTeam(async () => await invoices.create({
            ...invoice,
            number: await inject(InvoiceNumberService).generateTemporaryInvoiceNumber('siemens', customer),
            issuedAt: null
        }));

        await expect(inTeam(async () => await cancellations.cancelInvoice(creditNote.id))).rejects.toThrow(
            `The invoice ${creditNote.number} is a credit note, and a credit note cannot be credited.`
        );
        await expect(inTeam(async () => await cancellations.cancelInvoice(draft.id))).rejects.toThrow(
            `The invoice ${draft.number} is not issued, and a draft is deleted rather than credited.`
        );
        // a final number issues an invoice, on its date, which is then credited
        const numbered: Invoice = await inTeam(async () => await invoices.create({ ...invoice, number: `${invoice.number}-B`, issuedAt: null }));
        expect(numbered.issuedAt).toEqual(invoice.date);
        expect((await inTeam(async () => await cancellations.cancelInvoice(numbered.id))).type).toBe(InvoiceType.CREDIT_NOTE);
    });
});

describe('an invoice a credit note references', () => {
    it('cannot be changed or deleted', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        const creditNote: Invoice = await inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(10)]));
        const message: string = `The invoice ${invoice.number} is referenced by the credit note ${creditNote.number}, and cannot be changed or deleted.`;

        await expect(inTeam(async () => await invoices.updateById(invoice.id, { dueDate: new Date() }))).rejects.toThrow(message);
        await expect(inTeam(async () => await invoices.updateAll({ id: invoice.id }, { textAfterItems: ['Paid'] }))).rejects.toThrow(message);
        await expect(inTeam(async () => await invoices.deleteById(invoice.id))).rejects.toThrow(message);
        expect(await inTeam(async () => await invoices.findById(invoice.id))).toEqual(invoice);
    });

    it('is the only one that cannot: an invoice no credit note references is changed and deleted', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);

        await inTeam(async () => await invoices.updateById(invoice.id, { textAfterItems: ['Thank you'] }));
        await inTeam(async () => await invoices.deleteById(invoice.id));

        expect(await inTeam(async () => await invoices.findById(invoice.id, { required: false }))).toBeUndefined();
    });
});

describe('the documents of a credit note', () => {
    it('state type code 381, positive amounts and the preceding invoice, in an XRechnung and a Peppol invoice', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(invoice.id));

        for (const xml of [
            await inject(XRechnungConformanceService).generateXml(creditNote, 'Europe/Berlin'),
            await inject(PeppolConformanceService).generateXml(creditNote, 'Europe/Berlin')
        ]) {
            const document: CiiCrossIndustryInvoice = await XmlUtilities.parseFrom(CiiCrossIndustryInvoice, xml);
            expect(document.exchangedDocument).toMatchObject({ id: creditNote.number, typeCode: '381' });
            expect(document.supplyChainTradeTransaction.settlement.summation.duePayableAmount).toBe('119.00');
            expect(document.supplyChainTradeTransaction.settlement.invoiceReference).toEqual({
                issuerAssignedId: invoice.number,
                formattedIssueDateTime: { dateTimeString: { format: '102', value: '20261016' } }
            });
        }
        const ofInvoice: CiiCrossIndustryInvoice = await XmlUtilities.parseFrom(
            CiiCrossIndustryInvoice,
            await inject(XRechnungConformanceService).generateXml(invoice, 'Europe/Berlin')
        );
        expect(ofInvoice.exchangedDocument.typeCode).toBe('380');
        expect(ofInvoice.supplyChainTradeTransaction.settlement.invoiceReference).toBeUndefined();
    });

    it('show the credit note headline, number label and the preceding invoice in the pdf', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(invoice.id));

        const texts: string[] = JSON.stringify((await inject(InvoicePdfDefinitionService).resolveDefinition(creditNote)).content)
            .match(/"text":"[^"]*"/g) ?? [];
        const ofInvoice: string = JSON.stringify((await inject(InvoicePdfDefinitionService).resolveDefinition(invoice)).content);

        expect(texts).toEqual(expect.arrayContaining([
            '"text":"Credit note"',
            `"text":"Credit note no.: ${creditNote.number}"`,
            `"text":"Preceding invoice: ${invoice.number}, 10/16/2026"`
        ]));
        expect(texts).not.toContain(`"text":"Invoice-No.: ${creditNote.number}"`);
        expect(ofInvoice).toContain('"text":"Invoice"');
        expect(ofInvoice).toContain(`"text":"Invoice-No.: ${invoice.number}"`);
        expect(ofInvoice).not.toContain('Preceding invoice');
        const pdf: PdfDocument = await inject(InvoicePdfService).generateInvoicePdf(creditNote, 'en-US', 'Europe/Berlin', 'x-rechnung');
        pdf.end();
    });
});

describe('the payment state of an invoice', () => {
    // the application registers no payment source, such as the bank plugin, and payments are not known
    it('is not known without a payment source, credit note or not', async () => {
        const invoice: Invoice = await issueInvoice([itemOf(100)]);
        await inTeam(async () => await cancellations.createCreditNote(invoice.id, [itemOf(40)]));

        const state: InvoicePaymentState | undefined = await inTeam(
            async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE).resolvePaymentState(invoice)
        );

        expect(state).toBeUndefined();
    });
});