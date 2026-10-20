import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZibriInvoicingPlugin } from './invoicing.plugin.ts';
import { ElectronicAddress } from './models/electronic-address.model.ts';
import { InvoiceItem } from './models/invoice-item.model.ts';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model.ts';
import { Invoice } from './models/invoice.model.ts';
import { NumberInvoices } from './models/number-invoices.model.ts';
import { CiiCrossIndustryInvoice } from './services/conformance/en16931/cii/cii-cross-industry-invoice.model.ts';
import { CiiHeaderTradeSettlement } from './services/conformance/en16931/cii/cii-header-trade-settlement.model.ts';
import { CiiSchemedId } from './services/conformance/en16931/cii/cii-schemed-id.model.ts';
import { PeppolConformanceService } from './services/conformance/en16931/peppol-conformance.service.ts';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service.ts';
import { InvoicePdfService } from './services/invoice-pdf.service.ts';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { XmlUtilities } from '../../document/xml.utilities.ts';
import { type CurrencyCode } from '../../localization/models/currency-code.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';

// the amounts an invoice states, in its pdf and in its electronic invoice, as EN 16931 calculates
// them: each line rounded to the currency, the VAT of each group taxed once on the group's rounded
// lines, and the totals the sums of those. And the parties its electronic invoice names. In memory,
// as nothing here depends on where invoices are stored. Whether a validator accepts the documents is
// en16931-conformance.kosit.heavy.test.ts's

/**
 * An invoice of the given items, ready to be written.
 * @param items - Its items.
 * @param currency - Its currency.
 * @returns The invoice.
 */
function invoiceOf(items: InvoiceItem[], currency: CurrencyCode = 'EUR'): Invoice {
    return {
        id: UUIDUtilities.generate(),
        tenantId: UUIDUtilities.generate(),
        // cspell:disable-next-line
        number: '2026-GREATC-0001',
        items,
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: {
            formOfAddress: '',
            firstName: '',
            lastName: '',
            street: 'Great Street',
            number: '42',
            postcode: '12345',
            city: 'Great City',
            company: true,
            companyName: 'Great Company LLC',
            countryId: 'DE',
            email: 'info@great-company-llc.com'
        },
        textBeforeItems: [],
        textAfterItems: [],
        currency
    };
}

/**
 * An item at standard rate, a new object for its VAT each time, as items read from a data source are.
 * @param price - Its price.
 * @param rate - Its VAT rate.
 * @returns The item.
 */
function itemOf(price: number, rate: number = 19): InvoiceItem {
    return { name: 'Testing', amount: 1, amountUnit: { code: 'H87', displayName: 'Pieces' }, vat: { categoryCode: 'S', rate }, price };
}

/**
 * The electronic address the company of the tests is reached by, set by the cases about it.
 */
let companyElectronicAddress: ElectronicAddress | undefined;

// one application for the file: an application refuses a data source declared by another one the same
// file booted
let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example-company.com',
                phone: '12345 67890123',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                taxNumber: '123/456/78910',
                ceo: 'James Smith',
                iban: 'DE75 5121 0800 1245 1261 99',
                bic: 'ABCD5F',
                electronicAddress: companyElectronicAddress
            }))
        ]
    });
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

/**
 * The XRechnung of an invoice, as written.
 * @param invoice - The invoice.
 * @returns The document.
 */
async function xRechnungOf(invoice: Invoice): Promise<CiiCrossIndustryInvoice> {
    const xml: string = await inject(XRechnungConformanceService).generateXml(invoice, 'UTC');
    return await XmlUtilities.parseFrom(CiiCrossIndustryInvoice, xml);
}

/**
 * The settlement the XRechnung of an invoice states.
 * @param invoice - The invoice.
 * @returns Its settlement, as written.
 */
async function settlementOf(invoice: Invoice): Promise<CiiHeaderTradeSettlement> {
    return (await xRechnungOf(invoice)).supplyChainTradeTransaction.settlement;
}

describe('the amounts of an invoice', () => {
    it('writes a credit line as a negative quantity at a positive price, which EN 16931 asks for, its amount unchanged', async () => {
        const lines: CiiCrossIndustryInvoice['supplyChainTradeTransaction']['lineItems']
            = (await xRechnungOf(invoiceOf([itemOf(100), itemOf(-50, 7)]))).supplyChainTradeTransaction.lineItems;

        expect(lines.map(l => [l.delivery.billedQuantity.value, l.agreement.netPrice.chargeAmount, l.settlement.summation.lineTotalAmount]))
            .toEqual([['1', '100', '100.00'], ['-1', '50', '-50.00']]);
    });

    it('refuses a Peppol line whose amount is more than 0.02 from its quantity times its price', async () => {
        companyElectronicAddress = { scheme: '9930', value: 'DE123456789' };
        const invoice: Invoice = invoiceOf([itemOf(1000)], 'JPY');
        invoice.customerAddressData.electronicAddress = { scheme: '9930', value: 'DE987654321' };
        invoice.items.push(itemOf(1000.5));

        await expect(inject(PeppolConformanceService).generateXml(invoice, 'UTC')).rejects.toThrow(
            'Peppol allows the amount of a line to be at most 0.02 from its quantity times its price (PEPPOL-EN16931-R120), '
            + 'and line 2 is 1 × 1000.5 = 1000.5 JPY, rounded to 1001.'
        );
        // the same line in an XRechnung, which has no such rule
        expect((await settlementOf(invoice)).summation.lineTotalAmount).toBe('2001');
        companyElectronicAddress = undefined;
    });

    it('taxes each group once and states one breakdown for it, with at most two decimals', async () => {
        const settlement: CiiHeaderTradeSettlement = await settlementOf(invoiceOf([itemOf(9.99), itemOf(9.99), itemOf(9.99), itemOf(10.05, 7)]));

        expect(settlement.taxes.map(t => [t.categoryCode, t.rateApplicablePercent, t.basisAmount, t.calculatedAmount])).toEqual([
            ['S', '19', '29.97', '5.69'],
            ['S', '7', '10.05', '0.70']
        ]);
        expect(settlement.summation).toEqual({
            lineTotalAmount: '40.02',
            taxBasisTotalAmount: '40.02',
            taxTotalAmount: { currency: 'EUR', value: '6.39' },
            grandTotalAmount: '46.41',
            duePayableAmount: '46.41'
        });
    });

    it('writes a line rounded, and its price as given, in fixed notation', async () => {
        const xml: string = await inject(XRechnungConformanceService).generateXml(invoiceOf([itemOf(0.0000001), itemOf(1234567.125)]), 'UTC');
        const lines: CiiCrossIndustryInvoice['supplyChainTradeTransaction']['lineItems']
            = (await XmlUtilities.parseFrom(CiiCrossIndustryInvoice, xml)).supplyChainTradeTransaction.lineItems;

        expect(lines.map(l => [l.agreement.netPrice.chargeAmount, l.settlement.summation.lineTotalAmount])).toEqual([
            ['0.0000001', '0.00'],
            ['1234567.125', '1234567.13']
        ]);
    });

    it('states an amount in a currency without minor units without decimals', async () => {
        const settlement: CiiHeaderTradeSettlement = await settlementOf(invoiceOf([itemOf(1000.5)], 'JPY'));

        expect(settlement.summation.grandTotalAmount).toBe('1191');
    });

    it('refuses an electronic invoice in a currency of more minor units than EN 16931 allows', async () => {
        await expect(inject(XRechnungConformanceService).generateXml(invoiceOf([itemOf(1)], 'KWD'), 'UTC'))
            .rejects.toThrow('EN 16931 allows amounts of at most two decimals, and KWD has 3.');
        await expect(inject(PeppolConformanceService).generateXml(invoiceOf([itemOf(1)], 'KWD'), 'UTC'))
            .rejects.toThrow('EN 16931 allows amounts of at most two decimals, and KWD has 3.');
    });

    it('refuses an invoice whose total is negative, which is a credit note', async () => {
        const invoice: Invoice = invoiceOf([itemOf(100), itemOf(-150)]);
        const message: string = 'The invoice totals -50.00 EUR before tax. An invoice cannot total less than 0, issue a credit note instead.';

        await expect(inject(XRechnungConformanceService).generateXml(invoice, 'UTC')).rejects.toThrow(message);
        await expect(inject(InvoicePdfService).generateInvoicePdf(invoice, 'en-US', 'UTC')).rejects.toThrow(message);
        // a group may still be negative, as long as the invoice is not
        const settlement: CiiHeaderTradeSettlement = await settlementOf(invoiceOf([itemOf(100), itemOf(-50, 7)]));
        expect(settlement.taxes.map(t => [t.basisAmount, t.calculatedAmount])).toEqual([['100.00', '19.00'], ['-50.00', '-3.50']]);
        expect(settlement.summation.grandTotalAmount).toBe('65.50');
    });
});

describe('the parties of an electronic invoice', () => {
    afterEach(() => {
        companyElectronicAddress = undefined;
    });

    /**
     * The electronic addresses the parties of an XRechnung are named by.
     * @param invoice - The invoice.
     * @returns The seller's and the buyer's, as written.
     */
    async function electronicAddressesOf(invoice: Invoice): Promise<(CiiSchemedId | undefined)[]> {
        const agreement: CiiCrossIndustryInvoice['supplyChainTradeTransaction']['agreement'] = (await xRechnungOf(invoice)).supplyChainTradeTransaction.agreement;
        return [agreement.seller.communication?.uriId, agreement.buyer.communication?.uriId];
    }

    it('names a party by its electronic address, and by its email without one', async () => {
        const invoice: Invoice = invoiceOf([itemOf(100)]);
        invoice.customerAddressData.electronicAddress = { scheme: '0204', value: '991-01234-44' };

        expect(await electronicAddressesOf(invoice)).toEqual([
            { schemeId: 'EM', value: 'info@example-company.com' },
            { schemeId: '0204', value: '991-01234-44' }
        ]);
    });

    it('refuses a Peppol invoice without the electronic address of either party, as Peppol names no party by email', async () => {
        const invoice: Invoice = invoiceOf([itemOf(100)]);

        await expect(inject(PeppolConformanceService).generateXml(invoice, 'UTC')).rejects.toThrow(
            'Peppol names a party by its electronic address and not by its email: provide one for the seller (CompanyInfo.electronicAddress).'
        );
        companyElectronicAddress = { scheme: '9930', value: 'DE123456789' };
        await expect(inject(PeppolConformanceService).generateXml(invoice, 'UTC')).rejects.toThrow(
            'Peppol names a party by its electronic address and not by its email: provide one for the buyer (InvoiceAddress.electronicAddress).'
        );
    });
});