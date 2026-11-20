import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The deletion of a tenant and every row that belongs to it, which goes on in the background, after a crash too,
 * until the last row is gone.
 */
// shared, as it outlives the tenant it deletes
@Entity({ tenant: 'shared', allowOrphan: true })
export class TenantDeletion extends BaseEntity {
    /**
     * The id of the tenant.
     */
    @Property.string({ format: 'uuid', unique: true })
    tenantId!: string;

    /**
     * When the deletion started.
     */
    @Property.date()
    startedAt!: Date;

    /**
     * The entity whose rows are being deleted, or null before the first and once the last is done.
     */
    @Property.string({ required: false })
    deletingEntity?: string | null;

    /**
     * How many rows were deleted so far.
     */
    @Property.number({ format: 'integer' })
    deletedRows!: number;

    /**
     * When the last row was deleted, the tenant included, or null while the deletion goes on.
     */
    @Property.date({ required: false })
    finishedAt?: Date | null;
}

/**
 * What a tenant deletion is created with.
 */
export type TenantDeletionCreateData = OmitStrict<TenantDeletion, 'id'>;