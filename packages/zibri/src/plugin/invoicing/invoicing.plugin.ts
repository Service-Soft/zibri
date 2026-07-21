import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { ZibriPlugin } from '../plugin.model';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { Invoice } from './models/invoice.model';
import { InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { InvoicingOptions } from './models/invoicing-options.model';
import { NumberInvoices } from './models/number-invoices.model';
import { InvoiceCalcService } from './services/invoice-calc.service';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { ZibriApplication } from '../../application';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { PeppolConformanceService } from './services/conformance/en16931/peppol-conformance.service';
import { XRechnungConformanceService } from './services/conformance/en16931/x-rechnung-conformance.service';

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
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: InvoicingOptionsInput = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const res: InvoicingOptions = {
                    footerFontSize: 10,
                    images: undefined,
                    logo: undefined,
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
                    taxOffice: undefined,
                    bankDetailsLabel: 'Bank details:',
                    ibanLabel: 'IBAN:',
                    bicLabel: 'BIC/SWIFT:',
                    bankName: undefined,
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_INVOICING_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, Invoice, NumberInvoices);
        validateTokensRegistered(this.constructor.name, ZIBRI_INVOICING_PLUGIN_DI_TOKENS);
    }
}