import { AnyCache } from './cache/cache.interface.ts';

/**
 * Interface for a cache service.
 */
export interface CacheServiceInterface {
    /**
     * All caches that have been registered.
     */
    readonly caches: AnyCache[],
    /**
     * Invalidates the given tags through all caches, on every instance.
     *
     * Takes effect immediately on this instance and shortly afterwards on the others - they are
     * told through the data source rather than in the same breath, so treat invalidation as
     * eventually consistent across a deployment.
     */
    invalidateTags: (tags: string[]) => void | Promise<void>,
    /**
     * Applies the invalidations other instances have published since this one last looked.
     *
     * Driven by CacheInvalidationCronJob. Separate from invalidateTags so that applying a remote
     * invalidation does not publish it again.
     */
    applyPendingInvalidations: () => Promise<void>,
    /**
     * Removes the values whose time to live has run out from every registered cache.
     *
     * Driven by CacheExpiryCleanupCronJob. A value that expired is gone either way - what this decides
     * is whether the room it took goes back to the cache now or only once somebody asks for that
     * exact key again, which for a key nobody asks for twice is never.
     */
    removeExpiredValues: () => Promise<void>
}