/**
 * A cache the server used while it wrote a log.
 */
export type CacheContext = {
    /**
     * The name of the cache.
     */
    cache: string,
    /**
     * What was done with it, like 'get'.
     */
    operation: string,
    /**
     * The key that was read or written.
     */
    key?: unknown,
    /**
     * Whether a read found a value.
     */
    hit?: boolean | null,
    /**
     * How long it took.
     */
    durationInMs?: number | null
};