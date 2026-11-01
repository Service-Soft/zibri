import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { InvoicePdfService } from './invoice-pdf.service';
import { TestTimeouts } from '../../../__testing__/constants';
import { createFakeFont } from '../../../__testing__/fake-font.function';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { PdfFontOptions } from '../../../document/pdf-font-options.model';
import { PdfDocument } from '../../../document/pdf.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { InvoicingOptionsInput } from '../models/invoicing-options-input.model';
import { NumberInvoices } from '../models/number-invoices.model';

/**
 * The width and height of a page, in pt, as pdfkit lays it out.
 */
type PageDimensions = { width: number, height: number };

const LETTER: PageDimensions = { width: 612, height: 792 };
const A5: PageDimensions = { width: 419.53, height: 595.28 };

const invoicingOptions: InvoicingOptionsInput = { pageSize: 'LETTER', font: 'Brand' };

// the brand's font has Latin alone, so a Japanese name is set in the fallback
const fontOptions: PdfFontOptions = {
    families: {
        Brand: { normal: createFakeFont('FakeBrand', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-') },
        Cjk: { normal: createFakeFont('FakeCjkSans', '山田太郎') }
    },
    fallbacks: ['Cjk']
};

const invoice: Invoice = {
    id: UUIDUtilities.generate(),
    tenantId: UUIDUtilities.generate(),
    // eslint-disable-next-line cspell/spellchecker
    number: '2026-GREATC-0001',
    items: [{ name: 'Testing', amount: 1, amountUnit: { code: 'H87', displayName: 'Pieces' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }],
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
    currency: 'EUR'
};

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation], repositories: defaultTestServerRepositories })],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
            defineProvider({ token: ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS, useValue: fontOptions }),
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
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * The size of the first page of a pdf.
 * @param pdf - The pdf.
 * @returns Its width and height.
 */
function dimensionsOf(pdf: PdfDocument): PageDimensions {
    const dimensions: PageDimensions = { width: Math.round(pdf.page.width * 100) / 100, height: Math.round(pdf.page.height * 100) / 100 };
    pdf.end();
    return dimensions;
}

/**
 * Writes a pdf in full.
 * @param pdf - The pdf.
 * @returns The fonts it embeds, by the name it gives them, without the tag of the subset.
 */
async function embeddedFontsOf(pdf: PdfDocument): Promise<string[]> {
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended: Promise<void> = new Promise<void>(resolve => pdf.on('end', () => resolve()));
    pdf.end();
    await ended;
    const bytes: string = Buffer.concat(chunks).toString('latin1');
    return [...new Set([...bytes.matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g)].map(match => match[1] ?? ''))].sort();
}

describe('the fonts of an invoice pdf', () => {
    it('are the one the invoicing options name, and the fallback for a name it cannot draw', async () => {
        const japanese: Invoice = {
            ...invoice,
            customerAddressData: { ...invoice.customerAddressData, company: false, companyName: undefined, firstName: '太郎', lastName: '山田' }
        };

        const fonts: string[] = await embeddedFontsOf(await inject(InvoicePdfService).generateInvoicePdf(japanese, 'en-US', 'UTC'));

        expect(fonts).toEqual(['FakeBrand', 'FakeCjkSans']);
    });
});

describe('the page size of an invoice pdf', () => {
    it('is the one the invoicing options name', async () => {
        const pdf: PdfDocument = await inject(InvoicePdfService).generateInvoicePdf(invoice, 'en-US', 'UTC');

        expect(dimensionsOf(pdf)).toEqual(LETTER);
    });

    it('is the one the call names, over the options', async () => {
        const pdf: PdfDocument = await inject(InvoicePdfService).generateInvoicePdf(invoice, 'en-US', 'UTC', undefined, 'A5');

        expect(dimensionsOf(pdf)).toEqual(A5);
    });
});
