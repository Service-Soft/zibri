/* eslint-disable jsdoc/require-jsdoc */
import { InvoicingOptions, InvoicingOptionsInput } from './models';
import { InvoiceCalcServiceInterface, InvoiceNumberServiceInterface, InvoicePdfServiceInterface, InvoiceConformanceServiceInterface } from './services';
import { InjectionToken, TokenRecord } from '../../di';

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