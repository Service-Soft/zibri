/**
 * What a backup of a postgres data source covers, and so what a restore of it replaces.
 *
 * - `'schema'`: everything in the schema the data source works in, whoever created it: every table,
 * view, sequence, type and routine.
 * - `'entity-tables'`: the tables of the data source's entities, with their indexes, constraints,
 * grants and comments. Everything else in the schema is neither backed up nor touched by a restore.
 */
export type PostgresBackupScope = 'schema' | 'entity-tables';