import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * One instance telling every other instance that it invalidated some tags.
 *
 * Caches live in the memory of the process that holds them, so invalidating on the instance that
 * handled a write leaves every other instance serving the old value until its ttl runs out. That is
 * a permissions change that does not take effect, a price that stays wrong on two pods out of
 * three, and a "log out everywhere" that logs you out of one.
 *
 * Rows are short lived. They are a notification, not a record: every instance reads them, applies
 * the ones it has not seen, and they are deleted once old enough that no running instance can still
 * need them. An instance that was down for longer has empty caches anyway.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class CacheInvalidation extends BaseEntity {
    /**
     * The tags that were invalidated.
     */
    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    /**
     * When the invalidation happened. Only used to decide when the row can be deleted.
     */
    @Property.date({ default: () => new Date() })
    at!: Date;
}

/**
 * The data needed to publish an invalidation.
 */
export type CreateCacheInvalidationData = OmitStrict<CacheInvalidation, 'id' | 'at'> & {
    /**
     * When the invalidation happened. Defaults to now.
     */
    at?: Date
};