import { AnyCache } from './cache/cache.interface';

/**
 * Interface for a cache service.
 */
export interface CacheServiceInterface {
    /**
     * All caches that have been registered.
     */
    readonly caches: AnyCache[],
    /**
     * Invalidates the given tags through all caches.
     */
    invalidateTags: (tags: string[]) => void | Promise<void>
}