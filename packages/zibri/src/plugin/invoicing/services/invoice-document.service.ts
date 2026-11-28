import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { ArchiveUtilities } from '../../../archive/archive.utilities';
import { KeptRowDivergenceReason } from '../../../backup/kept-row-divergence-reason.enum';
import { type KeptRowDivergence } from '../../../backup/kept-row-divergence.model';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { TransactionUtilities } from '../../../data-source/transaction/transaction.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type PdfDocument, type PdfPageSize } from '../../../document/pdf.utilities';
import { type XmlString } from '../../../document/xml-string.type';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type FileRecord } from '../../../file/file-record.model';
import { MimeType } from '../../../http/mime-type.enum';
import { type LocaleCode } from '../../../localization/models/locale-code.model';
import { type Timezone } from '../../../localization/models/timezone.model';
import { $ts } from '../../../localization/translate.function';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { type CompanyInfo } from '../models/company-info.model';
import { type InvoiceArchiveOptions } from '../models/invoice-archive-options.model';
import { InvoiceDocument, type InvoiceDocumentCreateData } from '../models/invoice-document.model';
import { InvoiceType } from '../models/invoice-type.enum';
import { Invoice } from '../models/invoice.model';
import { type InvoicingOptions } from '../models/invoicing-options.model';
import { type InvoiceConformance, type InvoiceConformanceServiceInterface } from './conformance/invoice-conformance-service.interface';
import { type InvoiceDocumentServiceInterface } from './invoice-document-service.interface';

/**
 * How many ids one read looks for, so that the invoices of many documents are read in pages.
 */
const IDS_PER_READ: number = 500;

/**
 * Default implementation of the invoice document service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceDocumentService implements InvoiceDocumentServiceInterface {
    // read when used: without the archive of the options, InvoiceDocument is not declared
    private get documentRepository(): Repository<InvoiceDocument, InvoiceDocumentCreateData> {
        return inject(repositoryTokenFor(InvoiceDocument));
    }

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async archiveIssuedInvoices(invoices: Invoice[], transaction: RepositoryTransaction): Promise<void> {
        const archive: InvoiceArchiveOptions | undefined = this.options.archive;
        if (archive == undefined) {
            return;
        }
        TransactionUtilities.validateNotSpanning(transaction, 'The documents of an issued invoice are archived, which is chained');
        // one after the other, as the writes of one transaction run over one connection
        for (const invoice of invoices) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                invoice.tenantId,
                async () => await this.archive(invoice, archive, transaction)
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveKeptRowDivergences(): Promise<KeptRowDivergence[]> {
        if (this.options.archive == undefined) {
            return [];
        }
        const documents: Pick<InvoiceDocument, 'id' | 'invoiceId' | 'number'>[] = [];
        for await (const row of this.documentRepository.stream({ select: { id: true, invoiceId: true, number: true } })) {
            documents.push(row);
        }
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const issued: Map<string, boolean> = new Map();
        // in pages of ids, one after the other
        for (let start: number = 0; start < documents.length; start += IDS_PER_READ) {
            const page: string[] = documents.slice(start, start + IDS_PER_READ).map(d => d.invoiceId);
            for (const invoice of await invoices.findAll({
                where: { id: { oneOf: page } },
                select: { id: true, issuedAt: true },
                limit: 'all'
            })) {
                issued.set(invoice.id, invoice.issuedAt != undefined);
            }
        }
        return documents.flatMap((document): KeptRowDivergence[] => {
            const isIssued: boolean | undefined = issued.get(document.invoiceId);
            if (isIssued === true) {
                return [];
            }
            return [
                {
                    entity: InvoiceDocument.name,
                    id: document.id,
                    sourceEntity: Invoice.name,
                    sourceId: document.invoiceId,
                    reason: isIssued == undefined ? KeptRowDivergenceReason.SOURCE_MISSING : KeptRowDivergenceReason.SOURCE_DRAFT,
                    message: isIssued == undefined
                        ? `The documents archived of the invoice ${document.number} are kept, and the invoice is gone.`
                        : `The documents archived of the invoice ${document.number} are kept, and the invoice is a draft again.`
                }
            ];
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findDocument(invoiceId: string): Promise<InvoiceDocument | undefined> {
        return this.options.archive == undefined
            ? undefined
            : await this.documentRepository.findOne({ where: { invoiceId }, required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePdf(
        invoice: Invoice,
        locale: LocaleCode,
        timezone: Timezone,
        conformance: InvoiceConformance | undefined,
        pageSize: PdfPageSize | undefined
    ): Promise<Readable> {
        const archived: InvoiceDocument | undefined = invoice.issuedAt == undefined ? undefined : await this.findDocument(invoice.id);
        // an archived one read through the archive, which falls back to a copy when the bytes do not match
        return archived == undefined
            ? await this.renderPdf(invoice, locale, timezone, conformance, pageSize)
            : await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(archived, archived.pdf);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveElectronicInvoice(invoice: Invoice, conformance: InvoiceConformance, timezone: Timezone): Promise<Readable> {
        const archived: InvoiceDocument | undefined = invoice.issuedAt == undefined ? undefined : await this.findDocument(invoice.id);
        if (archived != undefined) {
            if (archived.electronicInvoice == undefined) {
                throw new NotFoundError($ts`The invoice ${invoice.number} was archived without an electronic invoice.`);
            }
            return await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(archived, archived.electronicInvoice);
        }
        const xml: XmlString | undefined = await this.resolveXml(invoice, conformance, timezone);
        if (xml == undefined) {
            throw new InternalError(`The conformance "${conformance}" writes no xml of its own, only the pdf carrying it.`);
        }
        return Readable.from([Buffer.from(xml, 'utf8')]);
    }

    /**
     * Renders the documents of an invoice issued, stores their files and archives them, in the tenant of the invoice.
     * @param invoice - The invoice as it is once written.
     * @param archive - How it is archived.
     * @param transaction - The transaction of the write issuing it, which is not spanning.
     */
    protected async archive(
        invoice: Invoice,
        archive: InvoiceArchiveOptions,
        transaction: RepositoryTransaction<InvoiceDocument>
    ): Promise<void> {
        // archived at its first issue already, such as an invoice a restore of the tenant brought back as a draft and
        // that is issued again: those documents are the ones it was sent with, and stay
        if (await this.documentRepository.exists({ where: { invoiceId: invoice.id }, transaction })) {
            return;
        }
        const issuedAt: Date = invoice.issuedAt ?? new Date();
        // the zone of the company issuing it, so the documents state the same days to everyone who reads them
        const company: CompanyInfo = await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE)
            .resolveCompanyInfo(invoice.tenantId);
        const conformance: InvoiceConformance | undefined = archive.resolveConformance(invoice);
        const pdf: Buffer = await buffer(await this.renderPdf(invoice, archive.locale, company.timezone, conformance, undefined));
        const xml: XmlString | undefined = conformance == undefined
            ? undefined
            : await this.resolveXml(invoice, conformance, company.timezone);
        // the bytes reach the store before the rows: those of a transaction rolled back are left to FileCleanupCronJob,
        // and the rows are rolled back with the invoice
        const store: string = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.DOCUMENT_FILE_STORE);
        const pdfRecord: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store(
            { store, name: `${invoice.number}.pdf`, mimeType: MimeType.PDF, data: pdf },
            transaction
        );
        const xmlRecord: FileRecord | undefined = xml == undefined
            ? undefined
            : await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store(
                { store, name: `${invoice.number}.xml`, mimeType: MimeType.XML, data: Buffer.from(xml, 'utf8') },
                transaction
            );
        await this.documentRepository.create(
            {
                invoiceId: invoice.id,
                number: invoice.number,
                type: invoice.type ?? InvoiceType.INVOICE,
                issuedAt,
                locale: archive.locale,
                timezone: company.timezone,
                conformance: conformance ?? null,
                pdf: pdfRecord.id,
                electronicInvoice: xmlRecord?.id ?? null,
                archivedAt: new Date(),
                retainUntil: ArchiveUtilities.resolveRetainUntil(
                    issuedAt,
                    { retention: archive.retention, from: 'endOfYear' },
                    inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
                )
            },
            { transaction }
        );
    }

    /**
     * Writes the xml of the electronic invoice of an invoice, for a conformance that writes one of its own.
     * @param invoice - The invoice.
     * @param conformance - The conformance.
     * @param timezone - The time zone the dates are read in.
     * @returns The xml, or undefined for a conformance that writes its xml into the pdf only.
     * @throws An InternalError for a conformance that is not registered.
     */
    protected async resolveXml(invoice: Invoice, conformance: InvoiceConformance, timezone: Timezone): Promise<XmlString | undefined> {
        const services: InvoiceConformanceServiceInterface<Invoice>[] = inject<InvoiceConformanceServiceInterface<Invoice>[]>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES
        );
        const service: InvoiceConformanceServiceInterface<Invoice> | undefined = services.find(s => s.name === conformance);
        if (service == undefined) {
            throw new InternalError(`No service of ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES writes "${conformance}".`);
        }
        return await service.generateXml?.(invoice, timezone);
    }

    /**
     * Renders the pdf of an invoice with the pdf service, finished.
     * @param invoice - The invoice.
     * @param locale - The locale.
     * @param timezone - The time zone its dates are read in.
     * @param conformance - The electronic invoice it carries, if any.
     * @param pageSize - The size of its pages, the `pageSize` of the options when undefined.
     * @returns The pdf, ended.
     */
    protected async renderPdf(
        invoice: Invoice,
        locale: LocaleCode,
        timezone: Timezone,
        conformance: InvoiceConformance | undefined,
        pageSize: PdfPageSize | undefined
    ): Promise<Readable> {
        const doc: PdfDocument = await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PDF_SERVICE)
            .generateInvoicePdf(invoice, locale, timezone, conformance, pageSize);
        doc.end();
        return doc;
    }
}