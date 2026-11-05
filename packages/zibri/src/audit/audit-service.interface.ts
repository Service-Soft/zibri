import { AuditVerification } from './audit-verification.model';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
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
     *
     * Given the transaction its writes are in, a success is recorded once the transaction commits, and
     * never when it is rolled back. A refusal is recorded at once either way.
     */
    record: (event: AuditEvent, transaction?: RepositoryTransaction) => void,
    /**
     * Waits until everything recorded so far is stored, the counted refusals included.
     *
     * Rejects when the data source refuses the write. The entries are kept and written again later.
     */
    flush: () => Promise<void>,
    /**
     * Deletes the entries older than `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS`, along with the
     * checkpoints sealing them.
     * @returns How many entries were deleted.
     */
    deleteExpiredEntries: () => Promise<number>,
    /**
     * Seals the entries stored since the last checkpoint, up to `ZIBRI_DI_TOKENS.AUDIT_SEAL_DELAY_IN_MS`
     * ago, in one `AuditCheckpoint` per tenant, and logs where each checkpoint leaves the chain of its
     * tenant. Does nothing when the trail is a chain.
     * @returns How many checkpoints were written.
     */
    writeCheckpoints: () => Promise<number>,
    /**
     * Resolves whether the trail of a tenant, or of the events of no tenant, holds: every entry as it
     * was recorded, and none removed from what is sealed.
     */
    resolveVerification: (tenantId: string | undefined) => Promise<AuditVerification>
}