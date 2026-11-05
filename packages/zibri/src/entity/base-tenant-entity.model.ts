import { BaseEntity } from './base-entity.model';
import { Property } from './decorators/property.decorator';
import type { ChangeSetEntity } from '../data-source/change-sets/models/change-set-entity.model';
import type { SoftDeleteEntity } from '../data-source/change-sets/models/soft-delete-entity.model';
import { Newable } from '../types/newable.type';

/**
 * A row that belongs to one tenant: an id, and the tenant in `tenantId`, which is where `@Entity()`
 * reads it from.
 */
export type TenantRow = BaseEntity & {
    /**
     * The uuid of the tenant the row belongs to.
     */
    tenantId: string
};

/**
 * Defines the base of an entity whose rows each belong to one tenant: `BaseEntity` with the tenant
 * in `tenantId`.
 */
export function BaseTenantEntity(): Newable<TenantRow>;
/**
 * Defines the base of an entity whose rows each belong to one tenant and are soft deleted.
 * @param base - `SoftDeleteEntity`, which the class extends.
 */
export function BaseTenantEntity(base: typeof SoftDeleteEntity): Newable<SoftDeleteEntity & TenantRow>;
/**
 * Defines the base of an entity whose rows each belong to one tenant and record their change sets.
 * @param base - `ChangeSetEntity`, which the class extends.
 */
export function BaseTenantEntity(base: typeof ChangeSetEntity): Newable<ChangeSetEntity & TenantRow>;
export function BaseTenantEntity(base: typeof BaseEntity = BaseEntity): Newable<TenantRow> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class TenantEntity extends base implements TenantRow {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        tenantId!: string;
    }

    return TenantEntity;
}