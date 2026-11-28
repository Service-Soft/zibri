/**
 * A value of a column of the statement of changes in fixed assets.
 */
export type EBilanzFixedAssetValueModel = {
    /**
     * The name of the column, such as `grossCost.beginning`.
     */
    column: string,
    /**
     * The German label of the column.
     */
    label: string,
    /**
     * The amount as a decimal, or null for NIL.
     */
    amount: string | null
};
