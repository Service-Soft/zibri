import { ZibriApplication } from '../../application/application';
import { ArchiveUtilities } from '../../archive/archive.utilities';
import { KEPT_ROW_CHECK_DI_VARIANT } from '../../backup/kept-row-check.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { FileRecord } from '../../file/file-record.model';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { Newable } from '../../types/newable.type';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { ZibriPlugin } from '../plugin.model';
import { InvoiceWriteObserver } from './invoice.write-observer';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { type InvoiceArchiveOptions } from './models/invoice-archive-options.model';
import { InvoiceDocument } from './models/invoice-document.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { Invoice } from './models/invoice.model';
import { InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { InvoicingOptions } from './models/invoicing-options.model';
import { NumberInvoices } from './models/number-invoices.model';
import { PeppolConformanceService } from './services/conformance/en16931/peppol-conformance.service';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service';
import { InvoiceCalcService } from './services/invoice-calc.service';
import { InvoiceCancellationService } from './services/invoice-cancellation.service';
import { InvoiceDocumentService } from './services/invoice-document.service';
import { InvoiceNumberFormatUtilities } from './services/invoice-number-format.utilities';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicePaymentService } from './services/invoice-payment.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceService } from './services/invoice.service';

/**
 * Plugin that includes everything for handling invoices. With the `archive` of its options, it archives the pdf and
 * the electronic invoice of each invoice and credit note as it is issued.
 */
export class ZibriInvoicingPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_INVOICING_PLUGIN_DI_TOKENS> = {
        INVOICE_NUMBER_SERVICE: { useClass: InvoiceNumberService },
        INVOICE_PDF_SERVICE: { useClass: InvoicePdfService },
        INVOICE_CALC_SERVICE: { useClass: InvoiceCalcService },
        INVOICE_CANCELLATION_SERVICE: { useClass: InvoiceCancellationService },
        INVOICE_PAYMENT_SERVICE: { useClass: InvoicePaymentService },
        INVOICE_CONFORMANCE_SERVICES: {
            useFactory: () => [inject(XRechnungConformanceService), inject(PeppolConformanceService)]
        },
        // the company issuing the invoices differs per tenant, and there is no sensible default for it
        COMPANY_INFO_SERVICE: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE, []);
            }
        },
        OPTIONS_INPUT: { useFactory: () => ({}) },
        OPTIONS: {
            useFactory: () => {
                const input: InvoicingOptionsInput = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const separator: string = input.separator ?? '-';
                const res: InvoicingOptions = {
                    pageSize: 'A4',
                    font: 'Roboto',
                    footerFontSize: 10,
                    images: undefined,
                    phoneLabel: 'Phone',
                    emailLabel: 'E-Mail',
                    headline: 'Invoice',
                    creditNoteHeadline: 'Credit note',
                    headlineFontSize: 20,
                    invoiceNumberLabel: 'Invoice-No.',
                    creditNoteNumberLabel: 'Credit note no.',
                    invoiceNumberNotice: 'Please specify when making payments and invoicing!',
                    precedingInvoiceLabel: 'Preceding invoice',
                    dateLabel: 'Date',
                    performanceDateLabel: 'Date of performance',
                    showPerformanceDate: false,
                    showDueDate: true,
                    dueDateLabel: 'Due date',
                    tableFontSize: 12,
                    itemNameLabel: 'Name',
                    totalLabel: 'Total',
                    totalBeforeTaxLabel: 'Total (excl. tax)',
                    totalAfterTaxLabel: 'Total (incl. tax)',
                    taxLabel: 'VAT',
                    taxNumberLabel: 'Tax number:',
                    ceoLabel: 'CEO:',
                    itemAmountLabel: 'Amount',
                    itemSinglePriceLabel: 'Price',
                    itemTotalPriceLabel: 'Total',
                    bankDetailsLabel: 'Bank details:',
                    ibanLabel: 'IBAN:',
                    bicLabel: 'BIC/SWIFT:',
                    // the numbers of before numberFormat, so that the counters stored then go on counting
                    numberFormat: `{year}${separator}{recipient}${separator}{counter}`,
                    creditNoteNumberFormat: '{invoice}-C{counter}',
                    numberOfDigits: 4,
                    creditNoteNumberOfDigits: 1,
                    separator,
                    numberCompanyAbbreviationCharacters: 6,
                    numberPrivateCustomerAbbreviationCharacters: 3,
                    issuedInvoicesReadOnly: false,
                    ...input,
                    // 8 years: § 147 AO keeps the documents behind the books that long, the invoices sent among
                    // them, since the Bürokratieentlastungsgesetz IV of 2025
                    archive: input.archive == undefined ? undefined : { retention: { years: 8 }, ...input.archive }
                };
                return res;
            }
        },
        INVOICE_DOCUMENT_SERVICE: { useClass: InvoiceDocumentService },
        INVOICE_SERVICE: { useClass: InvoiceService },
        KEPT_ROW_CHECK: {
            useFactory: () => inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE),
            variants: [KEPT_ROW_CHECK_DI_VARIANT]
        },
        // no store without an archive: every token is provided, so that a plugin's tokens are checked alike, and only
        // a declared InvoiceDocument reads the name, which the check of the file stores refuses as not registered,
        // with this name in its message
        DOCUMENT_FILE_STORE: {
            useFactory: () => inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS).archive?.store ?? 'none, as the invoicing options name no archive'
        }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_INVOICING_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override additionalLifecycleServices: Newable<unknown>[] = [InvoiceWriteObserver];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, Invoice, NumberInvoices, InvoiceRecipientAbbreviation);
        validateTokensRegistered(this.constructor.name, ZIBRI_INVOICING_PLUGIN_DI_TOKENS);
        const options: InvoicingOptions = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS);
        InvoiceNumberFormatUtilities.validateInvoiceFormat(
            InvoiceNumberFormatUtilities.getInvoiceFormat(options),
            'numberFormat of the invoicing options'
        );
        InvoiceNumberFormatUtilities.validateCreditNoteFormat(
            InvoiceNumberFormatUtilities.getCreditNoteFormat(options),
            'creditNoteNumberFormat of the invoicing options'
        );
        this.validateArchive(app, options.archive);
    }

    /**
     * Validates that the documents of issued invoices are archived either completely or not at all: with `archive`,
     * `InvoiceDocument` is declared in the data source of `Invoice`, which it is written in the transaction of. The
     * store it names is checked with the file properties of every entity, which refuses a declared `InvoiceDocument`
     * without `archive` as well.
     * @param app - The application.
     * @param archive - The archive of the options.
     * @throws An InternalError for an archive only half configured.
     */
    private validateArchive(app: ZibriApplication, archive: InvoiceArchiveOptions | undefined): void {
        if (archive == undefined) {
            return;
        }
        validateEntitiesRegistered(this.constructor.name, app, InvoiceDocument, FileRecord);
        ArchiveUtilities.validateRetention(archive.retention);
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const documents: Repository<InvoiceDocument> = inject(repositoryTokenFor(InvoiceDocument));
        if (invoices.dataSource !== documents.dataSource) {
            throw new InternalError(`${this.constructor.name} needs Invoice and InvoiceDocument in the same data source.`);
        }
    }
}