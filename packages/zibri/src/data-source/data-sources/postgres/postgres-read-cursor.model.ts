/**
 * Where the next backup of a postgres data source reading only what changed reads on from.
 */
export type PostgresReadCursor = {
    /**
     * The replication slot that holds the changes since.
     */
    slot: string,
    /**
     * The WAL position the backup read up to: every transaction committed before it is in the backup.
     */
    lsn: string,
    /**
     * The hash of the schema at that position, which the changes after it apply to while it is the same.
     */
    schemaHash: string
};