/**
 * An entity a migration names by the table it is stored in.
 *
 * What a migration names an entity by when it has to mean the same in every later version: the class
 * may be renamed, change its table, or be gone by the time the migration runs on a new database.
 */
export type MigrationTableReference = {
    /**
     * The table the entity is stored in.
     */
    tableName: string
};