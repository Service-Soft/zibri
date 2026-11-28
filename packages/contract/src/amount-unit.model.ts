/**
 * The unit of the amount of an invoice item: a display name such as "Hours" and a code such as `HUR`.
 */
export type AmountUnitModel = {
    /**
     * The name shown on the invoice.
     */
    displayName: string,
    /**
     * The code of the unit of UN/ECE Recommendation 20, which an electronic invoice states.
     */
    code: string
};