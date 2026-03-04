import { CompanyInfo } from './company-info.model';
import { PdfImageDefinition } from '../../../document/pdf.utilities';

/**
 * Options used throughout the plugin.
 */
export type InvoicingOptions = {
    /**
     * The font size that should be used for the footer.
     * @default 10
     */
    readonly footerFontSize: number,
    /**
     * Globally defined images which can be referenced by name inside the document definition.
     * @default undefined
     */
    readonly images: Record<string, PdfImageDefinition> | undefined,
    /**
     * Available options:
     *
     * - A reference by name to an image defined in PdfMakeDocumentDefinition.images
     * - A data URL
     * - A remote URL via http:// or https://.
     *
     * Supported image formats: JPEG, PNG.
     * @default undefined
     */
    readonly logo: string | undefined,
    /**
     * The label for the phone number on the invoice.
     * @default 'Phone'
     */
    readonly phoneLabel: string,
    /**
     * The label for the email on the invoice.
     * @default 'E-Mail'
     */
    readonly emailLabel: string,
    /**
     * The headline of the invoice.
     * @default 'Invoice'
     */
    readonly headline: string,
    /**
     * The font size of the headline.
     * @default 20
     */
    readonly headlineFontSize: number,
    /**
     * The label for the invoice number on the invoice.
     * @default 'Invoice No.'
     */
    readonly invoiceNumberLabel: string,
    /**
     * The notice below the invoice number.
     * @default 'Please specify when making payments and invoicing!'
     */
    readonly invoiceNumberNotice: string,
    /**
     * The label for the date on the invoice.
     * @default 'Date'
     */
    readonly dateLabel: string,
    /**
     * The label for the date of performance on the invoice.
     * @default 'Date of performance'
     */
    readonly performanceDateLabel: string,
    /**
     * Whether or not a performance date should be displayed on the invoice.
     * @default false
     */
    readonly showPerformanceDate: boolean,
    /**
     * Whether or not a due date should be displayed on the invoice.
     * @default true
     */
    readonly showDueDate: boolean,
    /**
     * The label for the due date on the invoice.
     * @default 'Due date'
     */
    readonly dueDateLabel: string,
    /**
     * The font size that should be used inside the tables.
     * @default 12
     */
    readonly tableFontSize: number,
    /**
     * The label for item name on the invoice.
     * @default 'Name'
     */
    readonly itemNameLabel: string,
    /**
     * The label for the total when no taxes exist on the invoice.
     * @default 'Total'
     */
    readonly totalLabel: string,
    /**
     * The label for the total before tax value on the invoice.
     * @default 'Total (excl. tax)'
     */
    readonly totalBeforeTaxLabel: string,
    /**
     * The label for the total after tax value on the invoice.
     * @default 'Total (incl. tax)'
     */
    readonly totalAfterTaxLabel: string,
    /**
     * The label for tax value on the invoice.
     * @default 'VAT'
     */
    readonly taxLabel: string,
    /**
     * The label for tax number on the invoice.
     * @default 'Tax number:'
     */
    readonly taxNumberLabel: string,
    /**
     * The label for the ceo on the invoice.
     * @default 'CEO:'
     */
    readonly ceoLabel: string,
    /**
     * The label for item amount on the invoice.
     * @default 'Amount'
     */
    readonly itemAmountLabel: string,
    /**
     * The label for single price of an item on the invoice.
     * @default 'Price'
     */
    readonly itemSinglePriceLabel: string,
    /**
     * The label for total price of an item on the invoice.
     * @default 'Total'
     */
    readonly itemTotalPriceLabel: string,
    /**
     * The tax office to display in the footer.
     * Can be omitted.
     */
    readonly taxOffice: string | undefined,
    /**
     * The label for the bank details in the footer.
     * @default 'Bank details:'
     */
    readonly bankDetailsLabel: string,
    /**
     * The label for the iban to display in the footer.
     * @default 'IBAN:'
     */
    readonly ibanLabel: string,
    /**
     * The label for the bic to display in the footer.
     * @default 'BIC/SWIFT:'
     */
    readonly bicLabel: string,
    /**
     * The bank name to display in the footer.
     * Can be omitted.
     */
    readonly bankName: string | undefined,
    /**
     * The information about the company sending out the invoice.
     */
    readonly companyInfo: CompanyInfo,
    /**
     * The number of digits used to generate the consecutive number.
     * @default 4
     */
    readonly numberOfDigits: number,
    /**
     * The separator for the parts of the invoice number.
     * @default '-'
     */
    readonly separator: string,
    /**
     * How many characters of the company name should be used in the invoice number.
     * @default 6
     */
    readonly numberCompanyAbbreviationCharacters: number,
    /**
     * How many characters of the private customer first and last name should be used in the invoice number.
     * @default 3
     */
    readonly numberPrivateCustomerAbbreviationCharacters: number
};