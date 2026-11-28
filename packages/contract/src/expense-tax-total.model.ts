/**
 * What the document of an expense states for one VAT rate. Amounts are decimal strings, such as `'100.00'`.
 */
export type ExpenseTaxTotalModel = {
    /**
     * The VAT rate in percent, such as `19`, or `0` for an amount without VAT.
     */
    rate: number,
    /**
     * The amount before tax, at least 0.
     */
    net: string,
    /**
     * The VAT, at least 0, which is posted as input tax.
     */
    tax: string
};
