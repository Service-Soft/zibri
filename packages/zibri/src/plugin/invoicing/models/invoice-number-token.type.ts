/**
 * A token of an invoice number format, the name it is written in braces with: `{year}`, the year in four digits,
 * `{yy}` in two, `{month}` in two, `{recipient}` the name abbreviation of the recipient, `{invoice}` the number of
 * the invoice a credit note corrects, and `{counter}`.
 */
export type InvoiceNumberToken = 'year' | 'yy' | 'month' | 'recipient' | 'invoice' | 'counter';