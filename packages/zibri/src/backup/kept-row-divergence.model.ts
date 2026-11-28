import { type KeptRowDivergenceReason } from './kept-row-divergence-reason.enum';

/**
 * A row that is kept as it was written, such as a journal entry, an archived document or a bank match, which no longer
 * matches the row it was written from: one a restore of a tenant brought back as it was, or took away.
 */
export type KeptRowDivergence = {
    /**
     * The entity of the kept row, such as `JournalEntry`.
     */
    entity: string,
    /**
     * The id of the kept row.
     */
    id: string,
    /**
     * The entity of the row it was written from, such as `Invoice`.
     */
    sourceEntity: string,
    /**
     * The id of the row it was written from, or null when the kept row names none.
     */
    sourceId: string | null,
    /**
     * How it no longer matches.
     */
    reason: KeptRowDivergenceReason,
    /**
     * What a person reads of it, such as `The entry 12 posted the invoice 2026-SIEMEN-0001, which is gone.`
     */
    message: string
};
