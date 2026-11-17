/**
 * What a resource's data was, as every transport received it.
 */
export type BackupDigest = {
    /**
     * The sha256 of the data, hex encoded.
     */
    checksum: string,
    /**
     * How many bytes it was.
     */
    size: number
};