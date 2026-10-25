import { AuditEvent } from '../logging/audit-event.model';

/**
 * Keeps the audit trail: the security relevant events, in a table of their own.
 */
export interface AuditServiceInterface {
    /**
     * Records an event, and logs it.
     *
     * Returns at once. A success is stored as an entry of its own. A refusal is too while the minute's
     * budget lasts; past it, refusals of one kind are counted into one entry.
     */
    record: (event: AuditEvent) => void,
    /**
     * Waits until everything recorded so far is stored, the counted refusals included.
     *
     * Rejects when the data source refuses the write. The entries are kept and written again later.
     */
    flush: () => Promise<void>,
    /**
     * Deletes the entries older than `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS`.
     * @returns How many were deleted.
     */
    deleteExpiredEntries: () => Promise<number>
}