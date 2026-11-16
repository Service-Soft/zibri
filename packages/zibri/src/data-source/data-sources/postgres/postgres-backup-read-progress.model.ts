/**
 * Where reading the data of a postgres data source for a backup stands, which the read notes as it goes and what
 * warns of a read that takes long names.
 */
export type PostgresBackupReadProgress = {
    /**
     * What the read does right now, such as `creating the slot` or `reading the table "task" in full`.
     */
    step: string,
    /**
     * Whether the read handed over data that the backup has not taken yet, and waits for it to read on.
     */
    waitsForReader: boolean
};