/**
 * The `sourceType` of the entries closing a fiscal year posts.
 */
export enum FiscalYearEntrySourceType {
    /**
     * The entry carrying the revenue and the expenses of a fiscal year into its result account, on its last day.
     */
    CLOSING = 'bookkeeping.closing',
    /**
     * The entry of the opening balances of a fiscal year, on its first day, from the closing of the one before.
     */
    OPENING = 'bookkeeping.opening'
}
