import { type EBilanzAppropriationPositions } from '../models/e-bilanz-appropriation-positions.model';
import { type EBilanzBusinessAssetComparisonPositions } from '../models/e-bilanz-business-asset-comparison-positions.model';
import { type EBilanzFieldContext } from '../models/e-bilanz-field-context.model';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { type EBilanzTotal } from '../models/e-bilanz-total.model';

/**
 * What the versions of the HGB taxonomy of one structure need beside their data: how the positions of the statements
 * of the books map to their positions, the positions with a meaning of their own, and the values of the fields of
 * their GCD module. A version names its adapter by `adapter`. A version reworking the structure, such as 7.0, comes
 * with an adapter of its own.
 */
export interface EBilanzTaxonomyAdapterInterface {
    /**
     * The name a version of the taxonomy names, such as `hgb-6`.
     */
    readonly name: string,
    /**
     * Resolves the position of a version of the taxonomy each position of the full statements of the books reports
     * as, by its id, such as `assets.B.IV` as `bs.ass.currAss.cashEquiv.misc`. An account mapped to a position missing
     * there needs a mapping of its own.
     * @param taxonomy - The version.
     * @returns The positions of the taxonomy by the id of the position of the books.
     */
    resolveStatementPositionMapping: (taxonomy: EBilanzTaxonomy) => Readonly<Record<string, string>>,
    /**
     * The position of the balance sheet the result of the year is part of, as in the books.
     */
    readonly balanceSheetResultPosition: string,
    /**
     * How a balance sheet drawn up after the partial appropriation of the result states it, such as that of a UG
     * putting part of its profit into the legal reserve: the positions of the books holding the result of the year and
     * the profit or loss carried forward, and the positions of the taxonomy stating the balance sheet profit
     * (Bilanzgewinn) and the appropriation of profits.
     */
    readonly appropriation: EBilanzAppropriationPositions,
    /**
     * The positions of the steuerlicher Betriebsvermögensvergleich (BVV), and those of the balance sheet whose accounts
     * are the equity it compares.
     */
    readonly businessAssetComparison: EBilanzBusinessAssetComparisonPositions,
    /**
     * The result of the income statement of each form, which the balance sheet result is checked against.
     */
    readonly incomeStatementResultPositions: Readonly<Record<'total-cost' | 'micro', string>>,
    /**
     * The totals of the assets and of the equity and liabilities, which need to be equal.
     */
    readonly balanceSheetTotals: readonly [string, string],
    /**
     * The totals of the statements of the books and the positions stating the same amount.
     */
    readonly totals: readonly EBilanzTotal[],
    /**
     * The position whose positions below it are the fixed assets of the statement of changes in fixed assets.
     */
    readonly fixedAssetsPosition: string,
    /**
     * The columns of the statement of changes in fixed assets the books resolve: the acquisition costs at the start of
     * the year, the additions of the year and the accumulated depreciation at its start, and the book value at its end,
     * which needs to equal the balance sheet.
     */
    readonly fixedAssetColumns: {
        /**
         * The column of the acquisition costs at the start of the year.
         */
        readonly grossBeginning: string,
        /**
         * The column of the additions of the year.
         */
        readonly additions: string,
        /**
         * The column of the accumulated depreciation at the start of the year.
         */
        readonly depreciationBeginning: string,
        /**
         * The column of the book value at the end of the year.
         */
        readonly bookValue: string
    },
    /**
     * Resolves the value of each field of the GCD module the books, the company and the preparation state, by its
     * name, a value for each occurrence. A field it has no value of is NIL.
     * @param context - What the fields are resolved from.
     * @returns The values.
     */
    resolveFieldValues: (context: EBilanzFieldContext) => ReadonlyMap<string, readonly string[]>,
    /**
     * Validates that a version of the taxonomy has every position and field the adapter names.
     * @param taxonomy - The version.
     * @throws An InternalError naming the first it does not have.
     */
    validateTaxonomy: (taxonomy: EBilanzTaxonomy) => void
}