/* eslint-disable jsdoc/require-jsdoc */
import { ZIBRI_INVOICING_DI_TOKENS } from './invoicing.tokens';
import { Invoice, InvoicingOptions, InvoicingOptionsInput, NumberInvoices } from './models';
import { InvoiceCalcService, InvoiceNumberService, InvoicePdfService, PeppolConformanceService, XRechnungConformanceService } from './services';
import { DiProvider, DiTokenProviderRecord, inject, providersFromTokenRecord } from '../../di';
import { NoProviderError } from '../../di/errors';
import { validateEntitiesRegistered } from '../../utilities';
import { ZibriPlugin } from '../plugin.model';

/**
 * Plugin that includes everything for handling invoices.
 */
export class ZibriInvoicingPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_INVOICING_DI_TOKENS> = {
        INVOICE_NUMBER_SERVICE: { useClass: InvoiceNumberService },
        INVOICE_PDF_SERVICE: { useClass: InvoicePdfService },
        INVOICE_CALC_SERVICE: { useClass: InvoiceCalcService },
        INVOICE_CONFORMANCE_SERVICES: {
            useFactory: () => [inject(XRechnungConformanceService), inject(PeppolConformanceService)]
        },
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: InvoicingOptionsInput = inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT);
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

    providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_INVOICING_DI_TOKENS, this.defaultDiProviders);

    validate(): void {
        validateEntitiesRegistered(this.constructor.name, Invoice, NumberInvoices);
        inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS);
    }
}