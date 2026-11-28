/**
 * What a credit note states besides its items, which the invoice it corrects gives it otherwise.
 */
export type CreditNoteData = {
    /**
     * The date of the credit note. Now by default.
     */
    readonly date?: Date,
    /**
     * The date the credited items were done. The performance date of the invoice by default.
     */
    readonly performanceDate?: Date,
    /**
     * The date the credited amount is paid back. The date of the credit note by default.
     */
    readonly dueDate?: Date,
    /**
     * The paragraphs before the items. None by default.
     */
    readonly textBeforeItems?: string[],
    /**
     * The paragraphs after the items. None by default.
     */
    readonly textAfterItems?: string[]
};