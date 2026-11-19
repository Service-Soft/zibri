import { FrameworkColumnRegistry } from '../../data-source/migration/framework-column.registry';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';

/**
 * Marks an entity whose rows are the tenants of the application, as a static member of its class.
 * `BaseTenantDefinitionEntity()` sets it.
 */
export const TENANT_ENTITY: unique symbol = Symbol('zibri.tenant-entity');

/**
 * Common properties shared by all tenants: a row whose id is the tenant id of everything it holds.
 */
export type BaseTenantDefinition = BaseEntity & {
    /**
     * The name of the tenant.
     */
    name: string
};

/**
 * A tenant that can be deactivated, and then deleted.
 */
export type DeactivatableTenantDefinition = BaseTenantDefinition & {
    /**
     * When the tenant was deactivated: every request for it is refused, and its queued work is gone. Undefined or
     * null for an active tenant.
     */
    deactivatedAt?: Date | null
};

/**
 * What a tenant entity is defined with.
 */
export type BaseTenantDefinitionOptions<Deactivatable extends boolean> = {
    /**
     * Whether tenants can be deactivated, and deleted once they are, which adds `deactivatedAt`.
     */
    deactivatable: Deactivatable
};

/**
 * Defines the base of the entity whose rows are the tenants: `BaseEntity` with a `name`. Declare it with
 * `@Entity({ tenant: 'shared' })`.
 */
export function BaseTenantDefinitionEntity(): Newable<BaseTenantDefinition>;
/**
 * Defines the base of the entity whose rows are the tenants, which cannot be deactivated.
 * @param options - `deactivatable: false`.
 */
export function BaseTenantDefinitionEntity(options: BaseTenantDefinitionOptions<false>): Newable<BaseTenantDefinition>;
/**
 * Defines the base of the entity whose rows are the tenants, with `deactivatedAt`, so that a tenant can be
 * deactivated and deleted.
 * @param options - `deactivatable: true`.
 */
export function BaseTenantDefinitionEntity(options: BaseTenantDefinitionOptions<true>): Newable<DeactivatableTenantDefinition>;
export function BaseTenantDefinitionEntity(
    options: BaseTenantDefinitionOptions<boolean> = { deactivatable: false }
): Newable<BaseTenantDefinition> | Newable<DeactivatableTenantDefinition> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class TenantDefinitionEntity extends BaseEntity implements BaseTenantDefinition {
        // eslint-disable-next-line jsdoc/require-jsdoc
        static readonly [TENANT_ENTITY]: true = true;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string()
        name!: string;
    }
    if (!options.deactivatable) {
        return TenantDefinitionEntity;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    class DeactivatableTenantDefinitionEntity extends TenantDefinitionEntity implements DeactivatableTenantDefinition {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        deactivatedAt?: Date | null;
    }
    // added by the data source to a table that lacks it, so that a tenant entity of 3.1 turned deactivatable takes no
    // migration of the application's
    FrameworkColumnRegistry.register({ entity: DeactivatableTenantDefinitionEntity, property: 'deactivatedAt' });
    return DeactivatableTenantDefinitionEntity;
}