/**
 * How the bank plugin matches transactions, as `matching` of its options.
 */
export type BankMatchingOptions = {
    /**
     * The confidence from which a suggestion of an invoice or an expense is approved by a policy, without a person,
     * from above 0 to 1. Every suggestion waits for a person when it is not given, and a suggestion of an account
     * always does.
     */
    readonly autoApproveConfidence?: number,
    /**
     * The most of an invoice a match may leave open, in its currency, such as `0.05`, for the invoice to count as paid:
     * the difference is posted to the payment difference accounts of the posting rules, split by the VAT rates of the
     * invoice. `0` leaves every difference open.
     */
    readonly paymentDifferenceTolerance: number
};