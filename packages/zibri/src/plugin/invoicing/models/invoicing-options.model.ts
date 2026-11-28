import { PdfImageDefinition, PdfPageSize } from '../../../document/pdf.utilities';
import { type InvoiceArchiveOptions } from './invoice-archive-options.model';

/**
 * Options used throughout the plugin.
 */
export type InvoicingOptions = {
    /**
     * The size of the pages of an invoice pdf, unless the call that renders it names one.
     * @default 'A4'
     */
    readonly pageSize: PdfPageSize,
    /**
     * The font family the invoice is set in, one of the `families` of `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`.
     * @default 'Roboto'
     */
    readonly font: string,
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
     * The headline of a credit note.
     * @default 'Credit note'
     */
    // TODO 4.0: required. Optional like every option 3.3 added, so that options written out whole for 3.2 stay valid
    readonly creditNoteHeadline?: string,
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
     * The label for the number on a credit note.
     * @default 'Credit note no.'
     */
    // TODO 4.0: required, see creditNoteHeadline
    readonly creditNoteNumberLabel?: string,
    /**
     * The notice below the invoice number.
     * @default 'Please specify when making payments and invoicing!'
     */
    readonly invoiceNumberNotice: string,
    /**
     * The label for the invoices an invoice references, such as the one a credit note corrects.
     * @default 'Preceding invoice'
     */
    // TODO 4.0: required, see creditNoteHeadline
    readonly precedingInvoiceLabel?: string,
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
     * The format invoice numbers are drawn in, unless the `CompanyInfo` of the tenant names one:
     * `{year}`, `{yy}`, `{month}`, `{recipient}` and `{counter}`, between any text. `{counter}` is
     * required, and counts anew for every distinct value of the rest.
     * @default '{year}-{recipient}-{counter}', with the `separator` between the parts
     */
    // TODO 4.0: required, see creditNoteHeadline
    readonly numberFormat?: string,
    /**
     * The format credit note numbers are drawn in, unless the `CompanyInfo` of the tenant names one:
     * `{invoice}`, the number of the invoice corrected, `{year}`, `{yy}`, `{month}` and `{counter}`,
     * between any text. `{counter}` is required.
     * @default '{invoice}-C{counter}'
     */
    // TODO 4.0: required, see creditNoteHeadline
    readonly creditNoteNumberFormat?: string,
    /**
     * The number of digits the counter of an invoice number is padded to.
     * @default 4
     */
    readonly numberOfDigits: number,
    /**
     * The number of digits the counter of a credit note number is padded to.
     * @default 1
     */
    // TODO 4.0: required, see creditNoteHeadline
    readonly creditNoteNumberOfDigits?: number,
    /**
     * The separator between `TEMP` and a temporary invoice number, and between the parts of the default
     * `numberFormat`.
     * @default '-'
     */
    readonly separator: string,
    /**
     * Whether an invoice with an `issuedAt` can no longer be changed or deleted. A credit note
     * corrects it instead.
     * @default false
     */
    // TODO 4.0: true by default, and required, see creditNoteHeadline
    readonly issuedInvoicesReadOnly?: boolean,
    /**
     * How the pdf and the electronic invoice of each invoice and credit note are archived once it is issued, or
     * undefined to archive none.
     * @default undefined
     */
    // optional rather than undefined by default, so that options written out whole before it stay valid
    readonly archive?: InvoiceArchiveOptions,
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