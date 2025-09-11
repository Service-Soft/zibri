/* eslint-disable jsdoc/require-jsdoc */
import { InvoicingOptions, InvoicingOptionsInput } from './models';
import { InvoiceCalcServiceInterface, InvoiceNumberServiceInterface, InvoicePdfServiceInterface, InvoiceConformanceServiceInterface } from './services';
import { DiProvider } from '../../di';
import { OmitStrict } from '../../types';

/**
 * The dependency injection tokens used by the ZibriInvoicingPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_INVOICING_DI_TOKENS = {
    INVOICE_NUMBER_SERVICE: 'zi.invoicing.invoice_number_service',
    OPTIONS_INPUT: 'zi.invoicing.options_input',
    OPTIONS: 'zi.invoicing.options',
    INVOICE_CALC_SERVICE: 'zi.invoicing.invoice_calc_service',
    INVOICE_PDF_SERVICE: 'zi.invoicing.invoice_pdf_service',
    INVOICE_CONFORMANCE_SERVICES: 'zi.invoicing.invoice_conformance_services'
} as const satisfies Record<string, `zi.invoicing.${string}`>;

export type ZibriInvoicingPluginDiProvider<T> = OmitStrict<DiProvider<T>, 'token'>;

export type ZibriInvoicingPluginDiProviders = {
    // eslint-disable-next-line typescript/no-explicit-any
    [ZIBRI_INVOICING_DI_TOKENS.INVOICE_NUMBER_SERVICE]: ZibriInvoicingPluginDiProvider<InvoiceNumberServiceInterface<any>>,
    [ZIBRI_INVOICING_DI_TOKENS.OPTIONS]: ZibriInvoicingPluginDiProvider<InvoicingOptions>,
    [ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT]: ZibriInvoicingPluginDiProvider<InvoicingOptionsInput>,
    // eslint-disable-next-line typescript/no-explicit-any
    [ZIBRI_INVOICING_DI_TOKENS.INVOICE_PDF_SERVICE]: ZibriInvoicingPluginDiProvider<InvoicePdfServiceInterface<any>>,
    // eslint-disable-next-line typescript/no-explicit-any
    [ZIBRI_INVOICING_DI_TOKENS.INVOICE_CALC_SERVICE]: ZibriInvoicingPluginDiProvider<InvoiceCalcServiceInterface<any>>,
    // eslint-disable-next-line typescript/no-explicit-any
    [ZIBRI_INVOICING_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES]: ZibriInvoicingPluginDiProvider<InvoiceConformanceServiceInterface<any>[]>
};