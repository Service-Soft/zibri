/**
 * A grant that has been taken and is currently being held by this instance.
 *
 * Deliberately not tied to how the grant is stored. A named lock lives in a valkey key, a claim on
 * an event or a queued mail lives in a row, and the difference matters to whoever took it and to
 * nobody else - what the framework needs from all three is the same three operations.
 */
export type HeldLease = {
    /**
     * What is being held. A lock key, or the id of the mail being sent.
     *
     * Used in the log lines about losing or force releasing a grant, so it has to say enough to find
     * the work again. Diagnostic only - nothing branches on it.
     */
    readonly name: string,
    /**
     * Extends the grant, so work that outlives the lease does not lose it.
     *
     * Throws a `LeaseLostError` when the grant is no longer this holder's, and whatever the store
     * threw when it could not be reached. Neither becomes the reason the work fails: the holder
     * logs it, and tells the work through its signal once the grant is lost for certain.
     */
    renew: () => Promise<void>,
    /**
     * Hands the grant back.
     *
     * Has to check that this holder still owns it. Releasing unconditionally is what turned one lost
     * exclusion into a permanent one in evaluation/10-leases-and-claims.md 10.1, because a lapsed
     * holder freed the lock that had replaced its own.
     */
    release: () => Promise<void>
};

/**
 * A grant that is being kept alive until whoever took it says otherwise.
 *
 * For a grant whose life is not a function call. A transaction holds one from its first write until
 * it commits or rolls back, and no callback wraps that.
 */
export type KeptGrant = {
    /**
     * Aborts, with a `LeaseLostError`, once the grant is lost: taken away, or not renewable for
     * longer than it lives.
     */
    readonly lost: AbortSignal,
    /**
     * Stops renewing the grant and hands it back.
     *
     * Safe to call more than once, and safe for two callers to call at once - both wait for the same
     * release rather than one returning while the grant is still being held.
     */
    release: () => Promise<void>
};