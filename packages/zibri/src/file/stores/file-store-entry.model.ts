/**
 * What a file store says of the bytes under a key, without reading them.
 */
export type FileStoreEntry = {
    /**
     * How many bytes the key holds.
     */
    readonly size: number,
    /**
     * When the bytes were last written.
     */
    readonly modifiedAt: Date
};