/**
 * What an E-Bilanz states of itself as its `revisionStatus` in the GCD module: the first one of a fiscal year, or how
 * it corrects one filed before.
 */
export enum EBilanzRevisionStatus {
    /**
     * The first E-Bilanz of the fiscal year (erstmalig).
     */
    ORIGINAL = 'original',
    /**
     * A balance sheet corrected for an error, § 4 (2) sentence 1 EStG (berichtigt).
     */
    CORRECTED = 'corrected',
    /**
     * A balance sheet changed in a choice it made, § 4 (2) sentence 2 EStG (geändert).
     */
    CHANGED = 'changed',
    /**
     * Both corrected and changed (berichtigt und geändert).
     */
    CORRECTED_AND_CHANGED = 'corrected-and-changed',
    /**
     * The same accounts with more detail, such as account level detail added (identischer Abschluss mit
     * differenzierteren Informationen).
     */
    MORE_DETAIL = 'more-detail',
    /**
     * A correction outside the balance sheet and the income statement only (sonstige Korrektur).
     */
    OTHER_CORRECTION = 'other-correction'
}