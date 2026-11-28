/**
 * The form of the income statement of an E-Bilanz.
 */
export enum EBilanzIncomeStatementForm {
    /**
     * By the nature of expense method (Gesamtkostenverfahren), § 275 (2) HGB.
     */
    TOTAL_COST = 'total-cost',
    /**
     * The shortened income statement of a micro corporation, § 275 (5) HGB, with its positions broken down as the
     * tax administration asks.
     */
    MICRO = 'micro'
}