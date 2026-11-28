/* eslint-disable cspell/spellchecker */
import { type Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { ChainGap } from '../../data-source/chain/chain-gap.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FileRecord } from '../../file/file-record.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { type CompanyInfo } from './models/company-info.model';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceDocument } from './models/invoice-document.model';
import { InvoiceItem } from './models/invoice-item.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { type InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { NumberInvoices } from './models/number-invoices.model';
import { type InvoiceDocumentServiceInterface } from './services/invoice-document-service.interface';

/**
 * The cases every data source answers the same way about archiving the documents of issued invoices. A file per data
 * source runs them, with {@link invoiceArchiveTestEntities}, the {@link InvoiceDocumentsFileStore} and
 * {@link invoiceArchiveTestProviders} registered, and the invoicing plugin.
 */

/**
 * The folder the archived documents of the cases are kept in.
 */
export const invoiceDocumentsFolder: FsPath = FsUtilities.getPath(testFileFolder, `invoice-documents-${UUIDUtilities.generate()}`);

/**
 * The file store the documents of issued invoices are archived in.
 */
@FileStore()
export class InvoiceDocumentsFileStore extends FsFileStore {
    constructor() {
        super('invoices', invoiceDocumentsFolder);
    }
}

/**
 * The entities the cases need, besides those of a test server.
 */
export const invoiceArchiveTestEntities: Newable<BaseEntity>[] = [
    Invoice,
    NumberInvoices,
    InvoiceRecipientAbbreviation,
    InvoiceDocument,
    FileRecord,
    ChainGap
];

/**
 * The name of the company issuing the invoices of the cases, which a case changes.
 */
let companyName: string = 'Example Company';

/**
 * The customer whose invoices are archived as a pdf alone.
 */
const PDF_ONLY_CUSTOMER: string = 'Paper Only LLC';

/**
 * The options of the cases: every invoice archived in `invoices`, in English, as an XRechnung, but those of
 * {@link PDF_ONLY_CUSTOMER}.
 */
export const invoiceArchiveTestOptions: InvoicingOptionsInput = {
    archive: {
        store: 'invoices',
        locale: 'en-US',
        resolveConformance: invoice => invoice.customerAddressData.companyName === PDF_ONLY_CUSTOMER ? undefined : 'x-rechnung'
    }
};

/**
 * The providers of the cases: the options, and the company of every tenant.
 */
export const invoiceArchiveTestProviders: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoiceArchiveTestOptions }),
    companyInfoProvider((): CompanyInfo => ({
        name: companyName,
        fullName: `${companyName} LLC`,
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
];

/**
 * The address of a customer, a company with an email, as an XRechnung names it.
 * @param companyName - The name of the company.
 * @returns The address.
 */
function customerOf(companyName: string): InvoiceAddress {
    return {
        formOfAddress: '',
        firstName: '',
        lastName: '',
        street: 'Great Street',
        number: '42',
        postcode: '12345',
        city: 'Great City',
        company: true,
        companyName,
        countryId: 'DE',
        email: 'info@great-company-llc.com'
    };
}

/**
 * An item of one hour of consulting at 19 %.
 * @param price - Its net price.
 * @returns The item.
 */
function itemOf(price: number): InvoiceItem {
    return { name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price };
}

function invoices(): Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> {
    return inject(repositoryTokenFor(Invoice));
}

function invoiceDocuments(): Repository<InvoiceDocument> {
    return inject(repositoryTokenFor(InvoiceDocument));
}

function documentService(): InvoiceDocumentServiceInterface {
    return inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE);
}

async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * The data of an invoice of the cases, of 1,000.00 at 19 % unless the items say otherwise.
 * @param number - Its number.
 * @param data - What differs.
 * @returns The data.
 */
function invoiceOf(number: string, data: Partial<Invoice> = {}): OmitStrict<Invoice, 'id' | 'tenantId'> {
    return {
        number,
        currency: 'EUR',
        items: [itemOf(1000)],
        date: new Date('2026-03-01T12:00:00.000Z'),
        performanceDate: new Date('2026-03-01T12:00:00.000Z'),
        dueDate: new Date('2026-03-15T12:00:00.000Z'),
        customerAddressData: customerOf('Great Company'),
        textBeforeItems: [],
        textAfterItems: [],
        ...data
    };
}

/**
 * Reads the bytes of a readable.
 * @param read - Resolves the readable.
 * @returns The bytes.
 */
async function bytesOf(read: () => Promise<Readable>): Promise<Buffer> {
    return await buffer(await read());
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeInvoiceArchive(dataSourceName: string): void {
    describe(`archiving the documents of issued invoices on ${dataSourceName}`, () => {
        it('archives the pdf, carrying the XRechnung, and its xml as an invoice is issued, kept 8 years from the end of its year', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const issuedAt: Date = new Date('2026-03-02T09:00:00.000Z');

            const invoice: Invoice = await inTenant(tenantId, async () => await invoices().create(invoiceOf('2026-GREATC-0001', { issuedAt })));

            const document: InvoiceDocument | undefined = await inTenant(tenantId, async () => await documentService().findDocument(invoice.id));
            expect(document).toMatchObject({
                tenantId,
                invoiceId: invoice.id,
                number: '2026-GREATC-0001',
                type: InvoiceType.INVOICE,
                issuedAt,
                locale: 'en-US',
                timezone: 'Europe/Berlin',
                conformance: 'x-rechnung',
                retainUntil: new Date('2035-01-01T00:00:00.000Z')
            });
            const files: FileRecord[] = await inTenant(tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE)
                .findFiles([document?.pdf ?? '', document?.electronicInvoice ?? '']));
            expect(files.map(f => [f.name, f.mimeType, f.storeName]).sort()).toEqual([
                ['2026-GREATC-0001.pdf', 'application/pdf', 'invoices'],
                ['2026-GREATC-0001.xml', 'application/xml', 'invoices']
            ]);
            const pdf: Buffer = await inTenant(tenantId, async () => await bytesOf(async () => await documentService()
                .resolvePdf(invoice, 'de', 'UTC', undefined, 'A5')));
            expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
            // the hybrid pdf, carrying the xml
            expect(pdf.includes('invoice.xml')).toBe(true);
            const xml: string = (await inTenant(tenantId, async () => await bytesOf(async () => await documentService()
                .resolveElectronicInvoice(invoice, 'peppol', 'UTC')))).toString();
            expect(xml).toContain('<rsm:CrossIndustryInvoice');
            expect(xml).toContain('xrechnung');
        });

        it('serves the archived documents of an issued invoice, the same bytes every time, whatever the company is since, and renders a draft', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const issued: Invoice = await inTenant(tenantId, async () => await invoices().create(invoiceOf('2026-GREATC-0002', { issuedAt: new Date() })));
            const draft: Invoice = await inTenant(tenantId, async () => await invoices().create(invoiceOf('TEMP-0001')));
            const resolvePdf: (invoice: Invoice) => Promise<Buffer> = async invoice => await inTenant(tenantId, async () => await bytesOf(
                async () => await documentService().resolvePdf(invoice, 'en-US', 'Europe/Berlin', 'x-rechnung', undefined)
            ));
            const resolveXml: (invoice: Invoice) => Promise<string> = async invoice => (await inTenant(tenantId, async () => await bytesOf(
                async () => await documentService().resolveElectronicInvoice(invoice, 'x-rechnung', 'Europe/Berlin')
            ))).toString();
            const archived: InvoiceDocument | undefined = await inTenant(tenantId, async () => await documentService().findDocument(issued.id));
            const storedPdf: Buffer = await inTenant(tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(archived?.pdf ?? ''));

            const first: Buffer = await resolvePdf(issued);
            const firstXml: string = await resolveXml(issued);
            companyName = 'Renamed Company';
            try {
                expect((await resolvePdf(issued)).equals(first)).toBe(true);
                expect(first.equals(storedPdf)).toBe(true);
                expect(await resolveXml(issued)).toBe(firstXml);
                expect(firstXml).toContain('Example Company LLC');
                // a draft is rendered as it is asked for, with the company as it is
                expect(await resolveXml(draft)).toContain('Renamed Company LLC');
                expect((await resolvePdf(draft)).subarray(0, 5).toString()).toBe('%PDF-');
                expect(await inTenant(tenantId, async () => await documentService().findDocument(draft.id))).toBeUndefined();
            }
            finally {
                companyName = 'Example Company';
            }
        });

        it('archives a draft as it is issued, and a credit note as it is created', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const draft: Invoice = await inTenant(tenantId, async () => await invoices().create(invoiceOf('TEMP-0002')));
            expect(await inTenant(tenantId, async () => await invoiceDocuments().count())).toBe(0);

            const issued: Invoice = await inTenant(tenantId, async () => await invoices().updateById(
                draft.id,
                { number: '2026-GREATC-0003', issuedAt: new Date() }
            ));
            // a write that changes nothing of whether it is issued archives nothing again
            await inTenant(tenantId, async () => await invoices().updateById(issued.id, { textAfterItems: ['Thank you'] }));
            expect(await inTenant(tenantId, async () => await invoiceDocuments().count())).toBe(1);
            const creditNote: Invoice = await inTenant(tenantId, async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE)
                .createCreditNote(issued.id, [itemOf(200)], { date: new Date('2026-04-01T12:00:00.000Z') }));

            const documents: InvoiceDocument[] = await inTenant(tenantId, async () => await invoiceDocuments().findAll({ limit: 'all' }));
            expect(documents.map(d => [d.invoiceId, d.number, d.type, d.conformance]).sort()).toEqual([
                [creditNote.id, creditNote.number, InvoiceType.CREDIT_NOTE, 'x-rechnung'],
                [issued.id, '2026-GREATC-0003', InvoiceType.INVOICE, 'x-rechnung']
            ].sort());
        });

        it('archives the pdf alone of an invoice resolveConformance names no electronic invoice of', async () => {
            const tenantId: string = UUIDUtilities.generate();

            const invoice: Invoice = await inTenant(tenantId, async () => await invoices().create(
                invoiceOf('2026-PAPERO-0001', { issuedAt: new Date(), customerAddressData: customerOf(PDF_ONLY_CUSTOMER) })
            ));

            const document: InvoiceDocument | undefined = await inTenant(tenantId, async () => await documentService().findDocument(invoice.id));
            expect(document).toMatchObject({ conformance: null, electronicInvoice: null });
            await expect(inTenant(tenantId, async () => await documentService().resolveElectronicInvoice(invoice, 'x-rechnung', 'UTC')))
                .rejects.toThrow('The invoice 2026-PAPERO-0001 was archived without an electronic invoice.');
        });

        it('refuses to issue an invoice whose documents cannot be rendered, and keeps nothing of it', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const files: number = await inTenant(tenantId, async () => await inject<Repository<FileRecord>>(repositoryTokenFor(FileRecord)).count());

            // a total below 0, which no pdf of an invoice states
            await expect(inTenant(tenantId, async () => await invoices().create(invoiceOf('2026-GREATC-0004', { items: [itemOf(-10)], issuedAt: new Date() }))))
                .rejects.toThrow('An invoice cannot total less than 0, issue a credit note instead.');

            expect(await inTenant(tenantId, async () => [await invoices().count(), await invoiceDocuments().count()])).toEqual([0, 0]);
            expect(await inTenant(tenantId, async () => await inject<Repository<FileRecord>>(repositoryTokenFor(FileRecord)).count())).toBe(files);
            // a draft of the same is written, as nothing is rendered of it
            await inTenant(tenantId, async () => await invoices().create(invoiceOf('TEMP-0003', { items: [itemOf(-10)] })));
            expect(await inTenant(tenantId, async () => await invoices().count())).toBe(1);
        });

        it('archives nothing of an invoice whose transaction is rolled back', async () => {
            const tenantId: string = UUIDUtilities.generate();

            await expect(inTenant(tenantId, async () => await invoices().dataSource.runInTransaction(async transaction => {
                await invoices().create(invoiceOf('2026-GREATC-0005', { issuedAt: new Date() }), { transaction });
                expect(await invoiceDocuments().count({ transaction })).toBe(1);
                throw new Error('The customer cancelled.');
            }, { maxAttempts: 1 }))).rejects.toThrow('The customer cancelled.');

            expect(await inTenant(tenantId, async () => [
                await invoices().count(),
                await invoiceDocuments().count(),
                await inject<Repository<FileRecord>>(repositoryTokenFor(FileRecord)).count()
            ])).toEqual([0, 0, 0]);
        });

        it('keeps the documents of each tenant to it', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const other: string = UUIDUtilities.generate();
            const invoice: Invoice = await inTenant(tenantId, async () => await invoices().create(invoiceOf('2026-GREATC-0006', { issuedAt: new Date() })));

            expect(await inTenant(other, async () => await documentService().findDocument(invoice.id))).toBeUndefined();
            expect(await inTenant(tenantId, async () => await documentService().findDocument(invoice.id))).toMatchObject({ tenantId });
        });
    });
}
