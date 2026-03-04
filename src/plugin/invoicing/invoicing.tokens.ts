/* eslint-disable jsdoc/require-jsdoc */
import { InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { InvoicingOptions } from './models/invoicing-options.model';
import { InvoiceConformanceServiceInterface } from './services/conformance/invoice-conformance-service.interface';
import { InvoiceCalcServiceInterface } from './services/invoice-calc-service.interface';
import { InvoiceNumberServiceInterface } from './services/invoice-number-service.interface';
import { InvoicePdfServiceInterface } from './services/invoice-pdf-service.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';

/**
 * The dependency injection tokens used by the ZibriInvoicingPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_INVOICING_DI_TOKENS = {
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_NUMBER_SERVICE: invoicingToken<InvoiceNumberServiceInterface<any>>('zi.invoicing.invoice_number_service'),
    OPTIONS_INPUT: invoicingToken<InvoicingOptionsInput>('zi.invoicing.options_input'),
    OPTIONS: invoicingToken<InvoicingOptions>('zi.invoicing.options'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_CALC_SERVICE: invoicingToken<InvoiceCalcServiceInterface<any>>('zi.invoicing.invoice_calc_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_PDF_SERVICE: invoicingToken<InvoicePdfServiceInterface<any>>('zi.invoicing.invoice_pdf_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    INVOICE_CONFORMANCE_SERVICES: invoicingToken<InvoiceConformanceServiceInterface<any>[]>('zi.invoicing.invoice_conformance_services')
} as const satisfies TokenRecord;

function invoicingToken<T = never>(k: `zi.invoicing.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}