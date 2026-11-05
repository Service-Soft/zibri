/**
 * How the audit trail tells an entry that was changed, removed or slipped in.
 *
 * - `'checkpoints'`: each `AuditEntry` carries a keyed hash of what it holds, and every hour of entries
 * is sealed in an `AuditCheckpoint`. Storing an entry costs no read. A removal is told once its hour is
 * sealed.
 * - `'chain'`: the `ChainedAuditEntry` rows of each tenant form a chain. A removal is told at once, and
 * each write reads where the chains it reaches end.
 */
export type AuditIntegrity = 'checkpoints' | 'chain';