/**
 * The account an amount of a VAT rate is posted on, as a rule of a posting rule set: the output tax, the input tax, or
 * the payment differences of that rate.
 */
export type PostingRuleTaxAccountModel = {
    /**
     * The VAT rate in percent, such as `19`.
     */
    rate: number,
    /**
     * The id of the account.
     */
    accountId: string
};
