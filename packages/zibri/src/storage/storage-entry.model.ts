/**
 * What a store says of the blob under a key, without reading it.
 */
export type StorageEntry = {
    /**
     * How many bytes the blob holds.
     */
    readonly size: number,
    /**
     * When the blob was last written.
     */
    readonly modifiedAt: Date
};