import { WhereFilter } from '../../data-source/models/where/where-filter.model.ts';
import { whereFor } from '../../data-source/models/where/where-for.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../entity/decorators/entity.decorator.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { type EntityTenant } from '../../entity/models/entity-tenant.model.ts';
import { coversEveryRow, declaresUnique, KeyWhere, UniqueGroup, uniqueWhereOf } from '../../entity/models/unique-declaration.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

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

    const tenant: EntityTenant | undefined = entityMetadata?.tenant;
    if (tenant == undefined || tenant === 'shared') {
        return res;
    }
    return withinTenant(res, tenant.property, properties[tenant.property]?.required === true);
}

/**
 * Puts the tenant property in front of every group of an entity whose rows belong to a tenant.
 *
 * A value one tenant holds says nothing about another tenant's rows, so a unique holds within a
 * tenant: two tenants each have their own `admin@example.com`. And every read of such an entity is
 * narrowed to one tenant, so an index that does not start with the tenant answers from rows of every
 * tenant. Here rather than in each store, so that every store, the upsert identities and the schema
 * all see the groups the same way.
 * @param groups - The groups as the entity declares them.
 * @param tenantProperty - The property holding the tenant of a row.
 * @param tenantRequired - Whether every row belongs to a tenant, or a row may belong to none.
 * @returns The groups each led by the tenant, and an index on the tenant alone when no group answers
 * a lookup by it.
 */
function withinTenant(groups: KeyGroups, tenantProperty: string, tenantRequired: boolean): KeyGroups {
    // a group already naming the tenant is unique or indexed per tenant as it was written - one row
    // of settings per tenant, say - and naming it twice would be the same column in one key twice
    const lead: (properties: string[]) => string[] = properties => properties.includes(tenantProperty)
        ? properties
        : [tenantProperty, ...properties];
    const indexes: string[][] = groups.indexes.map(lead);
    const uniques: UniqueGroup[] = groups.uniques.flatMap(group => {
        const led: UniqueGroup = { ...group, properties: lead(group.properties) };
        if (tenantRequired || group.properties.includes(tenantProperty)) {
            return [led];
        }
        // a row of no tenant holds null for the tenant, and no store compares a null in a unique,
        // so the led group lets any number of them hold the same value. The rows of no tenant get
        // a group of their own, unique among themselves the way each tenant's rows are
        return [led, { properties: group.properties, where: withNoTenant(group.where, tenantProperty) }];
    });
    // asked of by every read. An index answers a lookup by any leading part of itself, so every index
    // and every unique over all rows answers it already, each being led by the tenant; an entity
    // declaring neither gets one of its own
    if (!indexes.length && !uniques.some(group => group.properties[0] === tenantProperty && coversEveryRow(group.where))) {
        indexes.push([tenantProperty]);
    }
    return { uniques, indexes };
}

/**
 * Narrows the rows a unique covers to the rows of no tenant.
 * @param where - The rows the unique covers as it was declared, undefined for all of them.
 * @param tenantProperty - The property holding the tenant of a row.
 * @returns The same rows, of no tenant only.
 */
function withNoTenant(where: KeyWhere | undefined, tenantProperty: string): KeyWhere {
    // every branch, since they are alternatives: each covers rows of no tenant only from now on
    const branches: WhereFilter<BaseEntity>[] = where == undefined ? [{}] : Array.isArray(where) ? where : [where];
    // eslint-disable-next-line unicorn/no-null
    const narrowed: WhereFilter<BaseEntity>[] = branches.map(branch => ({ ...branch, [tenantProperty]: null }));
    return whereFor(narrowed.length === 1 ? narrowed[0] ?? {} : narrowed);
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