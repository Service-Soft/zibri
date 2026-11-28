/**
 * The positions of the taxonomy the steuerlicher Betriebsvermögensvergleich (BVV) of an E-Bilanz is stated by, and
 * those of the balance sheet it is resolved from.
 */
export type EBilanzBusinessAssetComparisonPositions = {
    /**
     * The equity of the balance sheet, whose accounts, and those of `deficitNotCoveredByCapital`, are the equity the
     * BVV compares.
     */
    readonly equity: string,
    /**
     * The deficit not covered by equity on the assets side of the balance sheet, which the equity is reduced by.
     */
    readonly deficitNotCoveredByCapital: string,
    /**
     * The result of the year of the BVV, which needs to equal that of the income statement.
     */
    readonly result: string,
    /**
     * The equity at the end of the fiscal year.
     */
    readonly equityAtEnd: string,
    /**
     * The equity at the end of the fiscal year before, as the opening entry of the fiscal year states it.
     */
    readonly equityAtPreviousEnd: string,
    /**
     * The adjustments of the equity at the end of the fiscal year before, 0 as the books state none.
     */
    readonly capitalAdjustments: string,
    /**
     * The distributions and withdrawals of the year.
     */
    readonly distributions: string,
    /**
     * The contributions of the year.
     */
    readonly contributions: string
};
