/* eslint-disable jsdoc-js/require-jsdoc */
import { InvoicingOptionsInput } from './models/invoicing-options-input.model.ts';
import { InvoicingOptions } from './models/invoicing-options.model.ts';
import { CompanyInfoServiceInterface } from './services/company-info-service.interface.ts';
import { InvoiceConformanceServiceInterface } from './services/conformance/invoice-conformance-service.interface.ts';
import { InvoiceCalcServiceInterface } from './services/invoice-calc-service.interface.ts';
import { InvoiceNumberServiceInterface } from './services/invoice-number-service.interface.ts';
import { InvoicePdfServiceInterface } from './services/invoice-pdf-service.interface.ts';
import { TokenRecord } from '../../di/models/di-token.model.ts';
import { InjectionToken } from '../../di/models/injection-token.model.ts';

/**
 * The dependency injection tokens used by the ZibriInvoicingPlugin.
 */
// eslint-disable-next-line typescript-js/typedef
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
    COMPANY_INFO_SERVICE: invoicingToken<CompanyInfoServiceInterface>('zi.invoicing.company_info_service')
} as const satisfies TokenRecord;

function invoicingToken<T = never>(k: `zi.invoicing.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}