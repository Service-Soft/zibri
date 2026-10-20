import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model.ts';
import { ZibriPlugin } from '../plugin.model.ts';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens.ts';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model.ts';
import { Invoice } from './models/invoice.model.ts';
import { InvoicingOptionsInput } from './models/invoicing-options-input.model.ts';
import { InvoicingOptions } from './models/invoicing-options.model.ts';
import { NumberInvoices } from './models/number-invoices.model.ts';
import { InvoiceCalcService } from './services/invoice-calc.service.ts';
import { InvoiceNumberService } from './services/invoice-number.service.ts';
import { InvoicePdfService } from './services/invoice-pdf.service.ts';
import { ZibriApplication } from '../../application/application.ts';
import { NoProviderError } from '../../di/errors/no-provider.error.ts';
import { inject } from '../../di/inject.function.ts';
import { DiProvider } from '../../di/models/di-provider.model.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function.ts';
import { PeppolConformanceService } from './services/conformance/en16931/peppol-conformance.service.ts';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service.ts';

/**
 * Plugin that includes everything for handling invoices.
 */
export class ZibriInvoicingPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_INVOICING_PLUGIN_DI_TOKENS> = {
        INVOICE_NUMBER_SERVICE: { useClass: InvoiceNumberService },
        INVOICE_PDF_SERVICE: { useClass: InvoicePdfService },
        INVOICE_CALC_SERVICE: { useClass: InvoiceCalcService },
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
                const res: InvoicingOptions = {
                    footerFontSize: 10,
                    images: undefined,
                    phoneLabel: 'Phone',
                    emailLabel: 'E-Mail',
                    headline: 'Invoice',
                    headlineFontSize: 20,
                    invoiceNumberLabel: 'Invoice-No.',
                    invoiceNumberNotice: 'Please specify when making payments and invoicing!',
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
                    numberOfDigits: 4,
                    separator: '-',
                    numberCompanyAbbreviationCharacters: 6,
                    numberPrivateCustomerAbbreviationCharacters: 3,
                    ...input
                };
                return res;
            }
        }

    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_INVOICING_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, Invoice, NumberInvoices, InvoiceRecipientAbbreviation);
        validateTokensRegistered(this.constructor.name, ZIBRI_INVOICING_PLUGIN_DI_TOKENS);
    }
}