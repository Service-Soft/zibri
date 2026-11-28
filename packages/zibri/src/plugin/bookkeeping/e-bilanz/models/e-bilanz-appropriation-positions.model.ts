/**
 * The positions of the books and of the taxonomy a balance sheet drawn up after the partial appropriation of the
 * result (§ 268 (1) HGB) is stated by.
 */
export type EBilanzAppropriationPositions = {
    /**
     * The position of the full balance sheet of the books holding the result of the year and the accounts
     * appropriating it, such as `equity-and-liabilities.A.V`.
     */
    readonly statementResultPosition: string,
    /**
     * The position of the full balance sheet of the books holding the profit or loss carried forward, such as
     * `equity-and-liabilities.A.IV`.
     */
    readonly statementCarriedForwardPosition: string,
    /**
     * The balance sheet profit or loss (Bilanzgewinn / Bilanzverlust) of the balance sheet.
     */
    readonly balanceSheetProfit: string,
    /**
     * The result of the year in the appropriation of profits.
     */
    readonly netIncome: string,
    /**
     * The profit carried forward from the year before.
     */
    readonly profitCarriedForward: string,
    /**
     * The loss carried forward from the year before.
     */
    readonly lossCarriedForward: string,
    /**
     * The allocation to the legal reserve, such as that of a UG, § 5a (3) GmbHG.
     */
    readonly legalReserve: string,
    /**
     * The allocations to other revenue reserves.
     */
    readonly otherReserves: string,
    /**
     * The releases of other revenue reserves.
     */
    readonly otherReservesReleased: string,
    /**
     * The balance sheet profit or loss the appropriation of profits ends with.
     */
    readonly total: string
};