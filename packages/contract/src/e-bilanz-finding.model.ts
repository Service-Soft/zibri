/**
 * Something an E-Bilanz needs before it can be filed, naming the position or field it is about.
 */
export type EBilanzFindingModel = {
    /**
     * The element name of the position or field, or the account number, the finding is about, or null for the whole.
     */
    position: string | null,
    /**
     * What needs to change, in the locale of the request.
     */
    message: string
};
