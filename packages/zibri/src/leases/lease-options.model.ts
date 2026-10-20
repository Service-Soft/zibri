import { Transaction } from '../data-source/transaction/transaction.model.ts';

/**
 * What to do when somebody else already holds the grant.
 *
 * The only thing that ever differed between the framework's locks and its claims, which is why it
 * is a parameter here rather than two separate primitives - see
 * evaluation/10-leases-and-claims.md.
 */
export type LeaseAcquisitionMode
    /**
     * Wait until the grant is free, then take it.
     *
     * For work that has to happen once and that everybody needs the result of. Schema setup is the
     * case: the replicas that lose the race wait, and then find the migrations already applied.
     */
    = 'wait'
    /**
     * Give up immediately when somebody else holds it.
     *
     * For work that only has to happen once and that nobody is waiting on. Every claim is this:
     * another replica is already sending the mail, so there is nothing to do but move on.
     */
        | 'skip';

/**
 * What happens to the grant once the work is over.
 *
 * The second axis, and the one that decides whether the row is only an exclusion or also a record
 * that the work has already been done.
 */
export type LeaseCompletion
    /**
     * Hand it back, so the work can be done again by whoever needs to.
     *
     * The right answer whenever the grant only protects work in progress - a named lock, a claim on
     * a mail that will be sent once and then marked sent.
     */
    = 'release'
    /**
     * Keep it, and let it lapse on its own `expiresAt` instead.
     *
     * For work that must not happen a second time, where the grant doubles as the record that it
     * already happened - a scheduled execution keyed by job and tick is the case. Releasing it would
     * let a replica that arrived late win the same key and run the job again.
     *
     * The alternative - release the grant and have the caller write its own "already done" record -
     * is two writes with a window between them, and a crash in that window permits exactly the
     * re-run this prevents.
     *
     * Kept whether the work succeeded or threw. Freeing it on failure would quietly turn a failed
     * run into one another replica retries, which is a change in behavior rather than a property of
     * the grant.
     */
        | 'retain'
    /**
     * Hand it back when the work returned, keep it when the work threw.
     *
     * For work that should not be retried the instant it fails - a send that died halfway through a
     * batch, a hook that hit an upstream that is down. Handing the grant back would let whichever
     * replica asks next start again immediately, and against something that is failing for a reason
     * that outlives one attempt, that is just a faster loop. The grant lapsing on its own
     * `expiresAt` is the backoff.
     *
     * Note that this keys off the work *throwing*, not off it reporting failure some other way.
     * Work that catches its own error and returns normally has said it handled it, and the grant is
     * handed back.
     */
        | 'retainOnError';

/**
 * What to take when taking several things at once, and how.
 *
 * No `mode` or `acquireTimeoutInMs`, and that is the type saying so rather than a note in a doc
 * comment: queueing for several keys at once is how two callers that want the same two keys in a
 * different order wait for each other forever. Taking a set is always 'skip', and the work runs over
 * whichever of the keys were free.
 */
export type LeaseSetOptions = {
    /**
     * How long the grants live before they lapse.
     *
     * Not an upper bound on the work: they are renewed underneath for as long as the work runs. It
     * only decides how long another instance waits before taking over from one that stopped
     * existing.
     */
    leaseInMs: number,
    /**
     * What to do with the grants once the work is over. Defaults to 'release'.
     */
    onCompletion?: LeaseCompletion
};

/**
 * What to take, and how.
 */
export type LeaseOptions = LeaseSetOptions & {
    /**
     * Names the one thing being held. Prefixed by whoever takes it, since the key space is shared.
     */
    key: string,
    /**
     * What to do when somebody else holds it. Defaults to 'skip'.
     */
    mode?: LeaseAcquisitionMode,
    /**
     * How long to keep trying in 'wait' mode before giving up.
     *
     * Waiting forever turns one stuck replica into a stuck deployment, so there is always a limit.
     * Reaching it throws rather than returning, since a caller that asked to queue cannot be told
     * "never mind" and left to carry on. Ignored in 'skip' mode, which never waits.
     *
     * Defaults to `leaseInMs`, which is the wrong value whenever the work may legitimately outlive
     * one lease - the two answer different questions. How long the work takes is not how long
     * another caller should be prepared to queue for it.
     */
    acquireTimeoutInMs?: number,
    /**
     * A transaction the work writes in. The grant is then held until the work has returned and the
     * transaction has ended, rather than until the work has returned, so the next holder sees what
     * was written once it is committed. Undefined, or a transaction that has ended already, holds it
     * until the work has returned.
     *
     * A transaction that is rolled back counts as work that threw, for `onCompletion`.
     */
    heldUntil?: Transaction
};