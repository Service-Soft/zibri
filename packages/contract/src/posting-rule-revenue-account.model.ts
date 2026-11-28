/**
 * The account the revenue of a VAT category and rate of an invoice is posted on, as a rule of a posting rule set.
 */
export type PostingRuleRevenueAccountModel = {
    /**
     * The VAT category code of the items, such as `S` for the standard rate or `E` for exempt, as an invoice states it.
     */
    categoryCode: string,
    /**
     * The VAT rate in percent, such as `19`.
     */
    rate: number,
    /**
     * The id of the revenue account.
     */
    accountId: string
};