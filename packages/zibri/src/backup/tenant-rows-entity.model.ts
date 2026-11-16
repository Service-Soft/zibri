import { Where } from '../data-source/models/where/where-filter.model';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';

/**
 * An entity whose rows a backup of a tenant holds, with what writing them back needs.
 */
export type TenantRowsEntity = {
    /**
     * The class of the entity.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The metadata of the entity.
     */
    metadata: EntityMetadata,
    /**
     * The filter that selects the rows of the tenant.
     */
    where: Where<BaseEntity>,
    /**
     * The relations to many rows whose join rows a row writes itself, read and written with it.
     */
    joined: string[],
    /**
     * The relations to a row of the same entity, whose target is written before the row.
     */
    selfReferences: string[],
    /**
     * The values of the references to rows of an entity written after this one, empty: what a row is
     * written with before its targets are, and what a stored row is set to before its targets are removed.
     */
    deferred: DeepPartial<BaseEntity>
};

/**
 * A row of a backup of a tenant's rows, as stored, with its entity.
 */
export type TenantRowsRow = [TenantRowsEntity, DeepPartial<BaseEntity>];