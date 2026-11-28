/**
 * How a kept row no longer matches the row it was written from.
 */
export enum KeptRowDivergenceReason {
    /**
     * The row it was written from is gone, such as an invoice a restore of a tenant took away.
     */
    SOURCE_MISSING = 'SOURCE_MISSING',
    /**
     * The row it was written from is a draft again, such as an invoice without an `issuedAt`.
     */
    SOURCE_DRAFT = 'SOURCE_DRAFT',
    /**
     * The row it was written from holds other amounts or another day than it was written with.
     */
    SOURCE_CHANGED = 'SOURCE_CHANGED'
}
