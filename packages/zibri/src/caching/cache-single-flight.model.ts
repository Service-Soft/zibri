import { cacheKeyOf } from './cache-key.function';

/**
 * Runs one call per cache key at a time, handing every other caller the same result.
 *
 * What stops a hot key expiring from becoming a burst of identical origin calls: the first caller
 * through a miss does the work, and everyone arriving while it runs waits on that same promise
 * instead of starting their own.
 *
 * Its own class rather than a method on a base class, because the caches that need it do not share
 * one: a multi tier cache is not a cache over a store, so it cannot inherit from the base that
 * happened to hold this - which is the whole of why it went without.
 */
export class CacheSingleFlight<V> {
    private readonly inFlight: Map<string, Promise<V>> = new Map();

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * How many calls are in flight right now.
     */
    get size(): number {
        return this.inFlight.size;
    }

    /**
     * Runs the factory, or joins the run already happening for this key.
     * @param key - The key being filled, in whatever form the key provider returned it.
     * @param factory - The work to do once.
     * @returns What the factory produced, for every caller that waited on it.
     */
    async run(key: unknown, factory: () => Promise<V>): Promise<V> {
        // by value rather than by reference: a key provider returning an object builds a new one per
        // call, and a map keyed by identity would never see the second caller as the same key
        const id: string = cacheKeyOf(key);
        const existing: Promise<V> | undefined = this.inFlight.get(id);
        if (existing !== undefined) {
            return await existing;
        }

        const promise: Promise<V> = (async () => {
            try {
                return await factory();
            }
            finally {
                this.inFlight.delete(id);
            }
        })();

        this.inFlight.set(id, promise);
        return await promise;
    }
}