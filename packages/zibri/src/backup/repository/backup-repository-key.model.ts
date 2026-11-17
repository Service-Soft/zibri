/**
 * The key of a repository of deduplicated backups: what the ids of its chunks are derived with, and what
 * the chunks and manifests are encrypted with.
 */
export type BackupRepositoryKey = {
    /**
     * Which key it is, as a manifest names it.
     */
    id: string,
    /**
     * What the id of a chunk is the keyed hash of its data with, and what chunk boundaries are keyed by.
     */
    idKey: Buffer,
    /**
     * What chunks and manifests are encrypted with.
     */
    dataKey: Buffer
};