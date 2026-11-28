/**
 * The tax of an invoice item: its rate in percent and its category code.
 */
export type VatModel = {
    /**
     * The rate in percent, such as `19`.
     */
    rate: number,
    /**
     * The category code, such as `S` for the standard rate or `AE` for reverse charge.
     */
    categoryCode: string,
    /**
     * Why the item is exempt from tax, for the category `E`.
     */
    exemptionReason?: string | null
};