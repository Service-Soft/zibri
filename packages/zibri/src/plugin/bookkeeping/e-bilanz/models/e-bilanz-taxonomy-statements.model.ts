import { type EBilanzTaxonomyPositionRow } from './e-bilanz-taxonomy-position-row.type';

/**
 * The statements of a version of the HGB taxonomy, each its positions in the order of the taxonomy: the balance sheet,
 * the income statement by the nature of expense method (Gesamtkostenverfahren), the income statement of a micro
 * corporation (§ 275 (5) HGB), the appropriation of profits and the steuerlicher Betriebsvermögensvergleich (BVV).
 */
export type EBilanzTaxonomyStatements = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly balanceSheet: readonly EBilanzTaxonomyPositionRow[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly incomeStatement: readonly EBilanzTaxonomyPositionRow[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly microIncomeStatement: readonly EBilanzTaxonomyPositionRow[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly appropriationOfProfits: readonly EBilanzTaxonomyPositionRow[],
    /**
     * The steuerlicher Betriebsvermögensvergleich (BVV): the result of the year as the equity at its end less that at
     * the end of the year before, plus the distributions and less the contributions of the year.
     */
    readonly businessAssetComparison: readonly EBilanzTaxonomyPositionRow[]
};

/**
 * A statement of the HGB taxonomy, such as `balanceSheet`.
 */
export type EBilanzStatementName = keyof EBilanzTaxonomyStatements;