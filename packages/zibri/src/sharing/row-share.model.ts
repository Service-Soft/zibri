import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A row of a shareable entity shared with a user of the tenant, in a role the entity declares. The user sees the row
 * and every row below it, see `ShareServiceInterface`.
 */
// the unique answers the shares of a row, the index those of a user, both after the tenant every key starts with
@Entity({ allowOrphan: true, uniques: [['entity', 'rowId', 'userId']], indexes: [['userId', 'entity']] })
export class RowShare extends BaseTenantEntity() {
    /**
     * The table name of the entity the row is of, such as `project`.
     */
    @Property.string()
    entity!: string;

    /**
     * The id of the row shared.
     */
    @Property.string({ format: 'uuid' })
    rowId!: string;

    /**
     * The id of the user it is shared with.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The role the share grants, one of those the entity declares.
     */
    @Property.string()
    role!: string;

    /**
     * The id of the user who shared it, or null when no user did, such as code running outside a request.
     */
    @Property.string({ format: 'uuid', required: false })
    sharedBy?: string | null;

    /**
     * When it was shared, or its role last changed.
     */
    @Property.date({ default: () => new Date() })
    sharedAt!: Date;
}

/**
 * The data to create a share with.
 */
export type RowShareCreateData = OmitStrict<RowShare, 'id' | 'sharedAt'>;
