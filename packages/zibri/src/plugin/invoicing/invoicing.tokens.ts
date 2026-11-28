/* eslint-disable jsdoc/require-jsdoc */
import { type KeptRowCheckInterface } from '../../backup/kept-row-check.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { DiVariant } from '../../di/models/di-variant.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { InvoicingOptions } from './models/invoicing-options.model';
import { CompanyInfoServiceInterface } from './services/company-info-service.interface';
import { InvoiceConformanceServiceInterface } from './services/conformance/invoice-conformance-service.interface';
import { InvoiceCalcServiceInterface } from './services/invoice-calc-service.interface';
import { InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { type InvoiceDocumentServiceInterface } from './services/invoice-document-service.interface';
import { InvoiceNumberServiceInterface } from './services/invoice-number-service.interface';
import { InvoicePaymentServiceInterface } from './services/invoice-payment-service.interface';
import { InvoicePdfServiceInterface } from './services/invoice-pdf-service.interface';
import { type InvoiceServiceInterface } from './services/invoice-service.interface';

/**
 * The dependency injection tokens used by the ZibriInvoicingPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_INVOICING_PLUGIN_DI_TOKENS = {
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_NUMBER_SERVICE: invoicingToken<InvoiceNumberServiceInterface<any>>('zi.invoicing.invoice_number_service'),
    OPTIONS_INPUT: invoicingToken<InvoicingOptionsInput>('zi.invoicing.options_input'),
    OPTIONS: invoicingToken<InvoicingOptions>('zi.invoicing.options'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_CALC_SERVICE: invoicingToken<InvoiceCalcServiceInterface<any>>('zi.invoicing.invoice_calc_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_PDF_SERVICE: invoicingToken<InvoicePdfServiceInterface<any>>('zi.invoicing.invoice_pdf_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_CONFORMANCE_SERVICES: invoicingToken<InvoiceConformanceServiceInterface<any>[]>('zi.invoicing.invoice_conformance_services'),
    COMPANY_INFO_SERVICE: invoicingToken<CompanyInfoServiceInterface>('zi.invoicing.company_info_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_CANCELLATION_SERVICE: invoicingToken<InvoiceCancellationServiceInterface<any>>('zi.invoicing.invoice_cancellation_service'),
    INVOICE_PAYMENT_SERVICE: invoicingToken<InvoicePaymentServiceInterface>('zi.invoicing.invoice_payment_service'),
    INVOICE_DOCUMENT_SERVICE: invoicingToken<InvoiceDocumentServiceInterface>('zi.invoicing.invoice_document_service'),
    INVOICE_SERVICE: invoicingToken<InvoiceServiceInterface>('zi.invoicing.invoice_service'),
    // the document service, as one of the checks a restore of a tenant asks, which it finds by their variant
    KEPT_ROW_CHECK: invoicingToken<KeptRowCheckInterface>('zi.invoicing.kept_row_check'),
    // the name of the store of the archived documents of issued invoices, read by InvoiceDocument, which names its
    // store by a token. The `store` of the `archive` of the options
    DOCUMENT_FILE_STORE: invoicingToken<string>('zi.invoicing.document_file_store')
} as const satisfies TokenRecord;

/**
 * The variant of the providers of invoice payment sources, such as the one of the bank plugin. The invoice payment
 * service adds up what each of them knows as paid.
 */
export const INVOICE_PAYMENT_SOURCE_DI_VARIANT: DiVariant = new DiVariant('invoice-payment-source');

/**
 * The variant of the providers that book invoices once they are issued, such as the one of the bookkeeping plugin.
 * Each implements `InvoicePostingInterface`, and is handed every invoice a write issues.
 */
export const INVOICE_POSTING_DI_VARIANT: DiVariant = new DiVariant('invoice-posting');

function invoicingToken<T = never>(k: `zi.invoicing.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}