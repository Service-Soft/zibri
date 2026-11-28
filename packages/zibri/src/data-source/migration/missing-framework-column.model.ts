import { type BaseEntity } from '../../entity/base-entity.model';
import { type Newable } from '../../types/newable.type';

/**
 * A column the framework added to one of its entities that the table of a data source managing no schema, with
 * `schemaManagement: 'external'`, lacks. Its rows are read and written without it, as a release before it did.
 */
export type MissingFrameworkColumn = {
    /**
     * The entity stored in the table.
     */
    entity: Newable<BaseEntity>,
    /**
     * The property the column holds.
     */
    property: string,
    /**
     * The table.
     */
    table: string,
    /**
     * The column.
     */
    column: string,
    /**
     * The statements that add it as the framework creates it: the column, the value the rows stored before it hold,
     * and the uniques and indexes that cover it.
     */
    statements: string[]
};