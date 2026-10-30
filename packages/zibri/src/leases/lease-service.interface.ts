import { HeldLease, KeptGrant } from './held-lease.model';
import { LeaseOptions, LeaseSetOptions } from './lease-options.model';

/**
 * Interface for a lease service.
 */
export interface LeaseServiceInterface {
    // the whole cycle in one call, because every part of it has been got wrong separately: acquiring
    // without renewing loses the grant under long work, renewing without releasing conditionally
    // frees somebody else's, and releasing before the work has finished is what a lock scoped to a
    // callback does. See evaluation/10-leases-and-claims.md
    /**
     * Takes the named grant, runs the work while keeping it alive, and hands it back afterwards.
     *
     * Returns undefined when the grant was not taken, which in 'skip' mode is the normal outcome on
     * every instance but one and is not an error.
     *
     * In 'wait' mode it never returns undefined - running out of patience throws
     * `LeaseAcquisitionTimeoutError` instead. A caller that asked to queue has said its work cannot
     * proceed without the grant, so returning quietly would let it carry on as though the work had
     * been done, which is the quiet failure this whole area is about.
     *
     * The work is handed a signal that aborts, with a `LeaseLostError`, once the grant is lost:
     * taken away by another instance, or not renewable for longer than it lives. Nothing stops the
     * work for it, since what it has already written stays written either way - but work that is
     * run again from the start by whoever takes the grant over has every reason to stop.
     */
    withLease: <T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>) => Promise<T | undefined>,

    /**
     * Takes as many of the named grants as are free, runs the work over those, and hands them back
     * afterwards.
     *
     * For work that is a batch: several items claimed together, done together, and released
     * together. The claim is on each item, so the next batch a moment later cannot take one that is
     * still being worked on.
     *
     * `fn` is given the keys that were actually taken, which may be fewer than were asked for and
     * is never empty - when every key is already held this returns undefined without running the
     * work at all - and the signal `withLease` hands its work, which here fires once any of them
     * is lost.
     *
     * Always skips what it cannot take. There is no waiting form: queueing for several keys at once
     * is how two callers that want the same two keys in a different order wait for each other
     * forever.
     */
    withLeases: <T>(
        keys: string[],
        options: LeaseSetOptions,
        fn: (taken: string[], lost: AbortSignal) => Promise<T>
    ) => Promise<T | undefined>,

    /**
     * Runs the work while keeping an already taken grant alive, and hands it back afterwards.
     *
     * For a grant this service did not take - one stored somewhere of the caller's own choosing.
     * Prefer `withLease`, which owns the whole cycle. The work is handed the same signal.
     */
    hold: <T>(lease: HeldLease, leaseInMs: number, fn: (lost: AbortSignal) => Promise<T>) => Promise<T>,

    /**
     * Starts keeping an already taken grant alive, and hands back the way to stop.
     *
     * For a grant whose life is not a function call. A transaction holds one from its first write
     * until it commits or rolls back, and no callback wraps that - which is the one thing `hold`
     * cannot express.
     *
     * Renewal, the shutdown drain and the release all behave exactly as they do under `hold`. In
     * particular a shutting down instance waits for whatever is still held before taking it away,
     * so an open transaction is not cut off the moment the process is asked to stop.
     */
    keepAlive: (lease: HeldLease, leaseInMs: number) => KeptGrant
}