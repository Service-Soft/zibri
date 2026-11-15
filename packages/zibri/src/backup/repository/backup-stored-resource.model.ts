/**
 * What the object a resource of a deduplicated backup is stored under turned out to hold, once its
 * first bytes are read.
 */
export type BackupStoredResource = {
    /**
     * The data of the resource as one piece, the way the transports of format 1 store it.
     */
    kind: 'whole',
    /**
     * The data, as it was stored.
     */
    data: AsyncIterable<Buffer>
} | {
    /**
     * A manifest of the chunks the data of the resource is cut into.
     */
    kind: 'chunks',
    /**
     * The id of the repository key the chunks and the manifest are encrypted with, or undefined for
     * unencrypted ones.
     */
    keyId: string | undefined,
    /**
     * The rest of the manifest, as it was stored.
     */
    body: Buffer
};