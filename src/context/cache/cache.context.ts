import { CacheOperation } from '../../caching/cache/cache-operation.enum';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * Context information about a cache that the program is currently using.
 */
export class CacheContext {
    /**
     * The name of the cache.
     */
    @Property.string()
    cache!: string;
    /**
     * The cache operation currently running.
     */
    @Property.string({ enum: CacheOperation })
    operation!: CacheOperation;
    /**
     * The key of the value in the cache.
     */
    @Property.unknown({ required: false })
    key?: unknown;
    /**
     * Whether or not the cache has been hit.
     */
    @Property.boolean({ required: false })
    hit?: boolean;
    /**
     * The duration that the original function took.
     */
    @Property.number({ required: false })
    durationInMs?: number;
}