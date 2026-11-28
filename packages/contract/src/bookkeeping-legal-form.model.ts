/**
 * A legal form the tenant keeping the books has from a day on, such as `UG` from 2025-01-01.
 */
export type BookkeepingLegalFormModel = {
    /**
     * The legal form, such as `UG` or `GmbH`, which the conformance services read.
     */
    legalForm: string,
    /**
     * The day the tenant has it from, until the next legal form of its history.
     */
    validFrom: Date
};