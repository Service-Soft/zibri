import { NoActiveTenantError } from './no-active-tenant.error.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../entity/decorators/entity.decorator.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { $ts } from '../../localization/translate.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { Where } from '../models/where/where-filter.model.ts';

/**
 * How the rows of one entity relate to tenants.
 */
export type TenantOwnership = {
    /**
     * The property holding the tenant of a row.
     */
    property: string,
    /**
     * Whether every row needs a tenant. A row without one is seen by every tenant.
     */
    required: boolean
};

/**
 * The data of one row a write sets, with the tenant the row belongs to.
 */
export type TenantRowData = {
    /**
     * The data being written.
     */
    data: object,
    /**
     * The tenant of the row, undefined for a row of no tenant.
     */
    rowTenant: string | undefined
};

/**
 * The existing rows of one entity that a write points at.
 */
export type TenantReference = {
    /**
     * The entity the rows belong to.
     */
    target: Newable<BaseEntity>,
    /**
     * The ids of the rows.
     */
    ids: string[]
};

/**
 * Narrows what a repository reads and writes to the rows of the active tenant.
 *
 * Kept apart from an entity's scopes rather than declared as one of them: a scope is what `unscoped`
 * lifts, and lifting it must never reach the rows of another tenant.
 */
export abstract class TenantUtilities {

    /**
     * Resolves how the rows of an entity relate to tenants.
     * @param entityClass - The entity.
     * @param metadata - Its entity metadata, which names its tenant property.
     * @returns The property and whether it is required, or undefined for an entity shared by every tenant.
     */
    static resolveOwnership(entityClass: Newable<BaseEntity>, metadata: EntityMetadata): TenantOwnership | undefined {
        if (metadata.tenant === 'shared') {
            return undefined;
        }
        const property: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[metadata.tenant.property];
        // `@Entity` refused anything else when the class was declared
        return { property: metadata.tenant.property, required: property?.required === true };
    }

    /**
     * Resolves the filter every call on an entity is narrowed by, given the tenant active right now.
     * @param entityClass - The entity being read or written.
     * @param metadata - Its entity metadata.
     * @param acrossTenants - Whether the call asked to reach every tenant.
     * @returns The filter, or undefined when the call is not narrowed to a tenant.
     * @throws {NoActiveTenantError} When every row needs a tenant and none is active.
     */
    static resolveRestriction<T extends BaseEntity>(
        entityClass: Newable<T>,
        metadata: EntityMetadata,
        acrossTenants: boolean | undefined
    ): Where<T> | undefined {
        const ownership: TenantOwnership | undefined = this.resolveOwnership(entityClass, metadata);
        if (ownership == undefined || acrossTenants === true) {
            return undefined;
        }

        const tenantId: string | undefined = AlsUtilities.getCurrentTenant();
        if (tenantId == undefined) {
            if (ownership.required) {
                throw this.resolveMissingTenantError(entityClass);
            }
            // outside every tenant, only the rows that belong to none of them
            // eslint-disable-next-line unicorn/no-null
            return { [ownership.property]: null } as Where<T>;
        }
        return ownership.required
            ? { [ownership.property]: tenantId } as Where<T>
            // eslint-disable-next-line unicorn/no-null
            : { [ownership.property]: { oneOf: [tenantId, null] } } as Where<T>;
    }

    /**
     * Resolves what an update or delete is narrowed by beyond what a read is.
     *
     * Inside a tenant a read also finds the rows of no tenant, which every tenant sees. A write reaches
     * the rows of the tenant alone, so that no tenant changes what all of them see.
     * @param entityClass - The entity being written.
     * @param metadata - Its entity metadata.
     * @param acrossTenants - Whether the call reaches every tenant.
     * @returns The filter, or undefined when a write reaches what a read does.
     */
    static resolveWriteRestriction<T extends BaseEntity>(
        entityClass: Newable<T>,
        metadata: EntityMetadata,
        acrossTenants: boolean | undefined
    ): Where<T> | undefined {
        const ownership: TenantOwnership | undefined = this.resolveOwnership(entityClass, metadata);
        const tenantId: string | undefined = AlsUtilities.getCurrentTenant();
        // a required tenant already narrows a read to the tenant's rows alone, and outside every
        // tenant a read reaches the rows of none, which is where they are changed
        if (ownership == undefined || ownership.required || acrossTenants === true || tenantId == undefined) {
            return undefined;
        }
        return { [ownership.property]: tenantId } as Where<T>;
    }

    /**
     * Fills in the tenant of a row about to be created, from the tenant active right now.
     *
     * A row that names its tenant keeps it, and whether that is a tenant the call may write to is left
     * to the restriction. Inside a tenant that is the active one; across tenants it is any of them, or
     * none for a row that names `null` where its tenant is optional.
     * @param data - The data of the row, changed in place.
     * @param entityClass - The entity being created.
     * @param metadata - Its entity metadata.
     * @param acrossTenants - Whether the call reaches every tenant.
     * @throws {NoActiveTenantError} When every row needs a tenant, the call is not across tenants and
     * none is active.
     * @throws When every row needs a tenant, and a call across tenants names none.
     */
    static assignTenant<T extends BaseEntity>(
        data: object,
        entityClass: Newable<T>,
        metadata: EntityMetadata,
        acrossTenants: boolean | undefined
    ): void {
        const ownership: TenantOwnership | undefined = this.resolveOwnership(entityClass, metadata);
        if (ownership == undefined) {
            return;
        }
        // the one place this writes a property the data's type does not name: which property holds
        // the tenant is declared on the entity rather than known to the type
        const writable: Record<string, unknown> = data as Record<string, unknown>;
        // null is a choice only across tenants: inside one, a row of no tenant would be a write every
        // other tenant reads
        const namesNoTenant: boolean = acrossTenants === true && !ownership.required && writable[ownership.property] === null;
        if (!namesNoTenant) {
            writable[ownership.property] ??= AlsUtilities.getCurrentTenant();
        }
        if (!ownership.required || writable[ownership.property] != undefined) {
            return;
        }
        if (acrossTenants !== true) {
            throw this.resolveMissingTenantError(entityClass);
        }
        throw new InternalError([
            `A "${entityClass.name}" belongs to a tenant, and this one was created across tenants without naming one.`,
            `Set "${ownership.property}" to the tenant it belongs to.`
        ]);
    }

    /**
     * Resolves what refuses reaching the rows of a tenant while none is active.
     * @param entityClass - The entity being read or written.
     * @returns A BadRequestError inside a request, whose tenant can only come from the request itself,
     * and a NoActiveTenantError anywhere else, where the code running forgot to name one.
     */
    private static resolveMissingTenantError(entityClass: Newable<unknown>): Error {
        if (AlsUtilities.getCurrentRequestContext() != undefined) {
            return new BadRequestError($ts`This request names no tenant.`);
        }
        return new NoActiveTenantError(entityClass);
    }

    /**
     * Resolves the tenant a row belongs to.
     * @param row - The row, as stored or as written.
     * @param entityClass - Its entity.
     * @returns The id of its tenant, or undefined for a row that belongs to none.
     */
    static resolveTenantOf(row: object, entityClass: Newable<BaseEntity>): string | undefined {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        const ownership: TenantOwnership | undefined = metadata == undefined ? undefined : this.resolveOwnership(entityClass, metadata);
        if (ownership == undefined) {
            return undefined;
        }
        const value: unknown = (row as Record<string, unknown>)[ownership.property];
        return typeof value === 'string' ? value : undefined;
    }

    /**
     * Whether the data of a write sets a relation, by a related row, an id or the column holding one.
     * @param data - The data being written.
     * @param entityClass - The entity being written.
     * @returns True when the write points the row at other rows.
     */
    static pointsAtRows(data: object, entityClass: Newable<BaseEntity>): boolean {
        const values: Record<string, unknown> = data as Record<string, unknown>;
        return Object.entries(MetadataUtilities.getModelProperties(entityClass)).some(([key, metadata]) => {
            if (!isRelationMetadata(metadata)) {
                return false;
            }
            const joinColumn: string | undefined = 'joinColumn' in metadata && typeof metadata.joinColumn === 'string'
                ? metadata.joinColumn
                : undefined;
            return values[key] != undefined || (joinColumn != undefined && values[joinColumn] != undefined);
        });
    }

    /**
     * Resolves the existing rows a write points at, and gives every new row it writes beside its own
     * the tenant of the row being written.
     *
     * A relation is set by a related row, by the id of one, or by the column holding that id, and a
     * related row without an id is a new one the write creates. A new row is handed the tenant rather
     * than checked later, since nothing about it exists yet; one naming another tenant is refused.
     * @param data - The data being written, changed in place where a new related row lacks a tenant.
     * @param entityClass - The entity being written.
     * @param rowTenant - The tenant of the row being written, undefined for one that belongs to none.
     * @returns The existing rows pointed at, per entity, whose tenant still has to be read.
     * @throws {ForbiddenError} When a new related row names a tenant other than the row's.
     */
    static resolveReferences(data: object, entityClass: Newable<BaseEntity>, rowTenant: string | undefined): TenantReference[] {
        const byTarget: Map<Newable<BaseEntity>, Set<string>> = new Map();
        this.collectReferences(data, entityClass, rowTenant, byTarget);
        return [...byTarget].map(([target, ids]) => ({ target, ids: [...ids] }));
    }

    /**
     * Walks the data of one row for {@link resolveReferences}, and the new rows it creates beside it.
     * @param data - The data of the row.
     * @param entityClass - Its entity.
     * @param rowTenant - The tenant the row and every row it creates belong to.
     * @param byTarget - Where the ids of existing rows are collected, per entity.
     * @throws {ForbiddenError} When a new related row names a tenant other than the row's.
     */
    private static collectReferences(
        data: object,
        entityClass: Newable<BaseEntity>,
        rowTenant: string | undefined,
        byTarget: Map<Newable<BaseEntity>, Set<string>>
    ): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const values: Record<string, unknown> = data as Record<string, unknown>;

        for (const metadata of Object.values(properties)) {
            // the column a to one relation is stored in is a way of setting it like any other
            const id: unknown = isRelationMetadata(metadata) && 'joinColumn' in metadata && typeof metadata.joinColumn === 'string'
                ? values[metadata.joinColumn]
                : undefined;
            if (isRelationMetadata(metadata) && typeof id === 'string') {
                this.addReference(byTarget, metadata.target(), id);
            }
        }

        for (const [key, value] of Object.entries(values)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (!isRelationMetadata(metadata) || value == undefined) {
                continue;
            }
            const target: Newable<BaseEntity> = metadata.target();
            for (const item of Array.isArray(value) ? value : [value]) {
                this.collectRelatedItem(item, target, rowTenant, byTarget);
            }
        }
    }

    /**
     * Walks one value a relation of a row is set to for {@link collectReferences}: the id of a row, a
     * row naming its id, or a new row.
     * @param item - The value.
     * @param target - The entity of the relation.
     * @param rowTenant - The tenant of the row being written.
     * @param byTarget - Where the ids of existing rows are collected, per entity.
     * @throws {ForbiddenError} When a new related row names a tenant other than the row's.
     */
    private static collectRelatedItem(
        item: unknown,
        target: Newable<BaseEntity>,
        rowTenant: string | undefined,
        byTarget: Map<Newable<BaseEntity>, Set<string>>
    ): void {
        if (typeof item === 'string') {
            this.addReference(byTarget, target, item);
            return;
        }
        if (item == undefined || typeof item !== 'object') {
            return;
        }
        if ('id' in item && typeof item.id === 'string') {
            this.addReference(byTarget, target, item.id);
            return;
        }
        this.assignTenantOfNewRow(item, target, rowTenant);
        this.collectReferences(item, target, rowTenant, byTarget);
    }

    /**
     * Notes the id of an existing row a write points at.
     * @param byTarget - The ids collected so far, per entity.
     * @param target - The entity of the row.
     * @param id - Its id.
     */
    private static addReference(byTarget: Map<Newable<BaseEntity>, Set<string>>, target: Newable<BaseEntity>, id: string): void {
        const ids: Set<string> = byTarget.get(target) ?? new Set();
        ids.add(id);
        byTarget.set(target, ids);
    }

    /**
     * Gives a related row a write creates the tenant of the row it is created with.
     * @param row - The new related row, changed in place.
     * @param target - Its entity.
     * @param rowTenant - The tenant of the row it is created with.
     * @throws {ForbiddenError} When the new row names another tenant, or belongs to tenants while the
     * row it is created with belongs to none.
     */
    private static assignTenantOfNewRow(row: object, target: Newable<BaseEntity>, rowTenant: string | undefined): void {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(target);
        const ownership: TenantOwnership | undefined = metadata == undefined ? undefined : this.resolveOwnership(target, metadata);
        const writable: Record<string, unknown> = row as Record<string, unknown>;
        if (ownership == undefined) {
            if (rowTenant != undefined) {
                throw new ForbiddenError($ts`A row of a tenant cannot be written together with a ${target.name}, which belongs to none.`);
            }
            return;
        }
        writable[ownership.property] ??= rowTenant;
        if (writable[ownership.property] !== rowTenant) {
            throw new ForbiddenError($ts`A ${target.name} has to belong to the tenant of the row it is written with.`);
        }
    }

    /**
     * Whether a change carries the tenant of a row in a way that could move the row to another one.
     *
     * A row's tenant never changes. A change naming the active tenant on a row that has to belong to
     * one says what is already true, so it is let through: a client sending a whole object back is an
     * ordinary update. Anything else could move the row - into a tenant, out of one, or across.
     * @param changed - The properties the change writes, with their values.
     * @param entityClass - The entity being changed.
     * @param metadata - Its entity metadata.
     * @param acrossTenants - Whether the call reaches every tenant.
     * @returns True when the change has to be refused.
     */
    static movesRow<T extends BaseEntity>(
        changed: object,
        entityClass: Newable<T>,
        metadata: EntityMetadata,
        acrossTenants: boolean | undefined
    ): boolean {
        const ownership: TenantOwnership | undefined = this.resolveOwnership(entityClass, metadata);
        if (ownership == undefined || !(ownership.property in changed)) {
            return false;
        }
        const value: unknown = (changed as Record<string, unknown>)[ownership.property];
        // across tenants there is no active tenant to compare with, so the row's own is unknown here
        return acrossTenants === true || !ownership.required || value !== AlsUtilities.getCurrentTenant();
    }
}