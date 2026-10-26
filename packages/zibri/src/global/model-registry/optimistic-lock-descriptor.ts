import { type Where, type WhereFilter } from '../../data-source/models/where/where-filter.model';
import { type BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the properties an entity refuses to have written blindly.
 *
 * Read on every update that names one of them, which is why it is resolved once per class rather
 * than walked out of the property metadata each time.
 */
export class OptimisticLockDescriptor {
    /**
     * The properties that may only be written by a call that also says what they were.
     */
    readonly keys: Set<string> = new Set();

    /**
     * Updates this descriptor from what the given class declares.
     * @param entityClass - The class to read the declarations from.
     */
    update(entityClass: Newable<unknown>): void {
        // per property and not a version counter per row: two people editing different properties of
        // one row do not collide, and a condition can name a property the write only read
        this.keys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            // not every kind of property can carry this, so the flag is checked for rather than read
            if ('optimisticLocking' in metadata && metadata.optimisticLocking) {
                this.keys.add(key);
            }
        }
    }

    /**
     * Resolves a filter that names every locked property with no value in each of its branches, which
     * is how a delete says it removes the rows whatever they hold.
     *
     * For the deletes that go along with another one, such as the rows of a relation removed with
     * their owner: what the caller based that delete on was checked on the owner.
     * @param where - The filter of the delete.
     * @returns The filter, naming the locked properties.
     */
    resolveRegardlessWhere<T extends BaseEntity>(where: Where<T>): Where<T> {
        if (!this.keys.size) {
            return where;
        }
        // keyed by the names the declarations gave, which a mapped type over the entity cannot follow
        const regardless: WhereFilter<T> = Object.fromEntries([...this.keys].map(key => [key, undefined])) as WhereFilter<T>;
        return Array.isArray(where) ? where.map(branch => ({ ...branch, ...regardless })) : { ...where, ...regardless };
    }
}