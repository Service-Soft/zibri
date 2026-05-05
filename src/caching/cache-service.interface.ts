import { CacheInterface } from './cache/cache.interface';

/**
 * Interface for a cache service.
 */
export interface CacheServiceInterface {
    /**
     * All caches that have been registered.
     */
    readonly caches: CacheInterface<unknown, unknown, string, boolean>[],
    /**
     * Invalidates the given tags through all caches.
     */
    invalidateTags: (tags: string[]) => void | Promise<void>
}