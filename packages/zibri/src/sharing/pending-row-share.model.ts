import { Property } from '../entity/decorators/property.decorator';

/**
 * A share an invitation carries, created for the account accepting it.
 */
export class PendingRowShare {
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
     * The role the share grants.
     */
    @Property.string()
    role!: string;
}
