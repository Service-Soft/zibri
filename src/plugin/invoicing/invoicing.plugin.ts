/* eslint-disable jsdoc/require-jsdoc */
import { DiProvider, inject, Injectable } from '../../di';
import { NoProviderError } from '../../di/errors';
import { validateEntitiesRegistered } from '../../utilities';
import { ZibriPlugin } from '../plugin.model';
import { ZIBRI_INVOICING_DI_TOKENS, ZibriInvoicingPluginDiProvider, ZibriInvoicingPluginDiProviders } from './invoicing.tokens';
import { Invoice, InvoicingOptions, InvoicingOptionsInput, NumberInvoices } from './models';
import { InvoiceCalcService, InvoiceNumberService, InvoicePdfService, PeppolConformanceService, XRechnungConformanceService } from './services';

/**
 * Plugin that includes everything for handling invoices.
 */
@Injectable()
export class ZibriInvoicingPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: Record<
        typeof ZIBRI_INVOICING_DI_TOKENS[keyof typeof ZIBRI_INVOICING_DI_TOKENS],
        ZibriInvoicingPluginDiProvider<unknown>
    > = {
        [ZIBRI_INVOICING_DI_TOKENS.INVOICE_NUMBER_SERVICE]: { useClass: InvoiceNumberService },
        [ZIBRI_INVOICING_DI_TOKENS.INVOICE_PDF_SERVICE]: { useClass: InvoicePdfService },
        [ZIBRI_INVOICING_DI_TOKENS.INVOICE_CALC_SERVICE]: { useClass: InvoiceCalcService },
        [ZIBRI_INVOICING_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES]: {
            useFactory: () => [inject(XRechnungConformanceService), inject(PeppolConformanceService)]
        },
        [ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT]: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        [ZIBRI_INVOICING_DI_TOKENS.OPTIONS]: {
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

    } satisfies ZibriInvoicingPluginDiProviders;

    providers: DiProvider<unknown>[] = this.getProviders();

    private getProviders(): DiProvider<unknown>[] {
        const res: DiProvider<unknown>[] = [];
        for (const key in ZIBRI_INVOICING_DI_TOKENS) {
            // eslint-disable-next-line stylistic/max-len
            const token: typeof ZIBRI_INVOICING_DI_TOKENS[keyof typeof ZIBRI_INVOICING_DI_TOKENS] = ZIBRI_INVOICING_DI_TOKENS[key as keyof typeof ZIBRI_INVOICING_DI_TOKENS];
            res.push({ token, ...this.defaultDiProviders[token] });
        }
        return res;
    }

    validate(): void {
        validateEntitiesRegistered(this.constructor.name, Invoice, NumberInvoices);
        inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS);
    }
}