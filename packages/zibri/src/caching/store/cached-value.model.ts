import { Property } from '../../entity/decorators/property.decorator';

/**
 * Definition for a cached value.
 */
export class CachedValue<V> {
    /**
     * The timestamp at which the value has been cached.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The timestamp at which this cached value expires.
     */
    @Property.date({ required: false })
    expiresAt?: Date;
    /**
     * The actual value that has been cached.
     */
    @Property.unknown({ required: false })
    value!: V;
    /**
     * Optional tags that the value can have and can be invalidated by.
     */
    @Property.array({ items: { type: 'string' } })
    tags!: string[];
}