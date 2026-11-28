/**
 * A position of the statements of the books and the position of the taxonomy stating the same amount, such as the
 * balance sheet totals, which an E-Bilanz is checked against.
 */
export type EBilanzTotal = {
    /**
     * The id of the position of the full statement of the books, such as `assets`.
     */
    readonly statementPosition: string,
    /**
     * The name of the position of the taxonomy, such as `bs.ass`.
     */
    readonly position: string
};
