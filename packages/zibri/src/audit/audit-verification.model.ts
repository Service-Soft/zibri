/**
 * An audit trail whose every entry is as it was recorded.
 */
export type IntactAuditTrail = {
    /**
     * Always true.
     */
    intact: true,
    /**
     * The place of the newest checkpoint, or of the newest entry when the trail is a chain, or 0 for
     * none. Keep it, and the hash, outside the data source: the trail alone cannot tell that the newest
     * of it was removed.
     */
    newestSequence: number,
    /**
     * The hash at that place, or an empty string for none.
     */
    newestHash: string,
    /**
     * Where the newest checkpoint ends. The entries stored since then are not sealed yet, so removing
     * one of them goes unnoticed. Undefined when the trail is a chain, or nothing is sealed yet.
     */
    sealedUntil: Date | undefined
};

/**
 * An audit trail holding an entry or a checkpoint that was changed, removed or slipped in.
 */
export type BrokenAuditTrail = {
    /**
     * Always false.
     */
    intact: false,
    /**
     * What does not hold, and where.
     */
    reason: string
};

/**
 * What checking the audit trail of a tenant found.
 */
export type AuditVerification = IntactAuditTrail | BrokenAuditTrail;