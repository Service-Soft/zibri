/**
 * Guards the read modify write cycle of a rate limiter store.
 *
 * A repository cannot offer this on its own: reading the current state, running the updater and
 * writing the result are separate operations, so without a lock two concurrent updates read the same
 * state and one of them is silently lost.
 *
 * Which lock is the right one depends on where the app runs. A single instance only needs the
 * in process lock, everything that runs more than once needs one that lives outside of the process,
 * eg. The ValKeyRateLimiterLock.
 */
export interface RateLimiterLockInterface {
    /**
     * Runs the given operation while holding the lock for the given key.
     * @param key - The rate limit key to lock.
     * @param run - The operation to run while the lock is held.
     * @returns Whatever the operation returned.
     */
    withLock: <T>(key: string, run: () => Promise<T>) => Promise<T>
}

/**
 * A lock that only guards the current process.
 *
 * Correct for an app that runs exactly once, and the right choice together with the
 * InMemoryRateLimiterStore. As soon as an app runs more than one instance against a shared store,
 * this does not guard anything anymore, because the other instances know nothing about it.
 */
export class InProcessRateLimiterLock implements RateLimiterLockInterface {

    private readonly queues: Map<string, Promise<unknown>> = new Map();

    // eslint-disable-next-line jsdoc/require-jsdoc
    async withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
        // chaining onto the pending operation of this key serializes them without blocking other keys
        const pending: Promise<unknown> = this.queues.get(key) ?? Promise.resolve();
        // eslint-disable-next-line promise/prefer-await-to-then
        const res: Promise<T> = pending.then(run, run);

        // eslint-disable-next-line promise/prefer-await-to-then
        this.queues.set(key, res.catch(() => undefined));
        try {
            return await res;
        }
        finally {
            if (this.queues.get(key) === res) {
                this.queues.delete(key);
            }
        }
    }
}