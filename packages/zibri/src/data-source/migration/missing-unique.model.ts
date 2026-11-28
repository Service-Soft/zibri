import { type BaseEntity } from '../../entity/base-entity.model';
import { type Newable } from '../../types/newable.type';

/**
 * A unique an entity declares that the table of a data source managing no schema, with `schemaManagement: 'external'`,
 * lacks. Nothing keeps its values apart, and an upsert identifying its rows by it is refused.
 */
export type MissingUnique = {
    /**
     * The entity stored in the table.
     */
    entity: Newable<BaseEntity>,
    /**
     * The properties it covers.
     */
    properties: string[],
    /**
     * The table.
     */
    table: string,
    /**
     * The name the data source gives it, which an upsert names it by.
     */
    name: string,
    /**
     * The statements that create it as the framework creates it.
     */
    statements: string[]
};