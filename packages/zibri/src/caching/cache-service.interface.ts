import { AnyCache } from './cache/cache.interface';
import { type CacheTagMatcher } from './cache-tag-matchers';
import { type ZibriApplication } from '../application/application';

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
     * Takes effect immediately on this instance and shortly afterwards on the others, which are
     * told through the data source. Treat invalidation as eventually consistent across a deployment.
     */
    invalidateTags: (tags: string[]) => void | Promise<void>,
    /**
     * Registers something kept in memory besides the caches, such as the roles, to be told whenever a
     * tag is invalidated on any instance. Called while the application starts, from `onAppInit`.
     * The start is refused with a MissingEntitiesError naming the registrant when the application
     * declares no `CacheInvalidation`.
     * @param app - The application starting.
     * @param registrant - What registers, for the error.
     * @param tag - The tags to listen for: one tag, or a matcher like the tags of a cache.
     * @param listener - What runs when a tag it listens for is invalidated, with that tag.
     */
    registerInvalidationListener: (
        app: ZibriApplication,
        registrant: string,
        tag: CacheTagMatcher,
        listener: (tag: string) => Promise<void>
    ) => void,
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