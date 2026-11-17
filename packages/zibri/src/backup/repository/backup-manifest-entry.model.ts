/**
 * One chunk of a resource, as its manifest lists it.
 */
export type BackupManifestEntry = {
    /**
     * The id of the chunk, hex encoded.
     */
    id: string,
    /**
     * How many bytes of the resource's data the chunk holds.
     */
    length: number
};