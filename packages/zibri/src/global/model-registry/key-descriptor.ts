import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { declaresUnique, UniqueGroup, uniqueWhereOf } from '../../entity/models/unique-declaration.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * The column groups an entity declares, as both places that can declare them, merged.
 */
export type KeyGroups = {
    /**
     * The groups of columns that have to be unique together, each with the rows it covers.
     */
    uniques: UniqueGroup[],
    /**
     * The groups of columns that are indexed together.
     */
    indexes: string[][]
};

/**
 * Reads what a class declares, without going through the registry.
 *
 * Separate from the descriptor so that schema building can ask the same question without being the
 * first thing to touch the registry for a class. What a descriptor holds is decided when its class
 * is first asked for, and asking earlier than the rest of the boot expects changes which of two
 * classes in a relation cycle is resolved against a finished copy of the other.
 * @param entityClass - The class to read the declarations from.
 * @returns Everything the class declares unique or indexed.
 */
export function keyGroupsOf(entityClass: Newable<unknown>): KeyGroups {
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
    const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass as Newable<never>);
    const res: KeyGroups = { uniques: [], indexes: [] };

    for (const [key, metadata] of ObjectUtilities.entries(properties)) {
        // not every kind of property can carry these, so the flags are checked for rather than read
        if ('unique' in metadata && declaresUnique(metadata.unique)) {
            res.uniques.push({ properties: [key], where: uniqueWhereOf(metadata.unique) });
        }
        if ('index' in metadata && metadata.index) {
            res.indexes.push([key]);
        }
    }

    res.uniques.push(...entityMetadata?.uniques ?? []);
    res.indexes.push(...entityMetadata?.indexes ?? []);
    return res;
}

/**
 * A descriptor that keeps track of the column groups an entity declares a key for.
 *
 * Uniqueness and indexing are each declared in two places - on the property for the single column
 * case, on the entity for the case that spans several - and everything downstream wants them as one
 * list. Resolved once per class and read from here, because the places that need them are the ones
 * that run per operation: an upsert resolving which constraint its identity refers to, and the
 * valkey driver deciding which lookups it can answer without reading every row.
 */
export class KeyDescriptor {
    /**
     * The groups of columns that have to be unique together.
     *
     * A property with `unique` is a group of one. Each group is in the order it was declared, which
     * is the order everything derived from it has to use - a constraint name on sql, a key on valkey.
     */
    readonly uniques: UniqueGroup[] = [];

    /**
     * The groups of columns that are indexed together.
     *
     * A property with `index` is a group of one. Order is significant here rather than only stable:
     * an index on `(tenantId, status)` answers a lookup by `tenantId`, and one by `status` alone
     * reads the table.
     */
    readonly indexes: string[][] = [];

    /**
     * Updates this descriptor from what the given class declares.
     * @param entityClass - The class to read the declarations from.
     */
    update(entityClass: Newable<unknown>): void {
        const groups: KeyGroups = keyGroupsOf(entityClass);
        this.uniques.length = 0;
        this.uniques.push(...groups.uniques);
        this.indexes.length = 0;
        this.indexes.push(...groups.indexes);
    }

    /**
     * Resolves the unique group covering exactly the given columns.
     *
     * Matched as a set but returned as it was declared: a caller should not have to know which order
     * the entity used, while everything derived from the group has to come out the same for all of
     * them.
     * @param columns - The columns to find a group for, in any order.
     * @returns The group in its declared order, or undefined when nothing covers exactly those.
     */
    uniqueGroupCovering(columns: string[]): UniqueGroup | undefined {
        return this.uniques.find(
            g => g.properties.length === columns.length && g.properties.every(c => columns.includes(c))
        );
    }
}