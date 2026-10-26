/**
 * Where a backup stands.
 */
export enum BackupStatus {
    /**
     * Its resources are being stored, on whichever instance claimed each.
     */
    RUNNING = 'RUNNING',
    /**
     * Every resource is stored, and the transports hold its record. Only such a backup is restored.
     */
    COMPLETED = 'COMPLETED',
    /**
     * A resource spent its attempts without being stored. Its `error` says why.
     */
    FAILED = 'FAILED'
}
