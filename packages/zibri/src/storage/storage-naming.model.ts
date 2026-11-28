/**
 * How a store keeping blobs under keys is named in its errors, and what it throws for a key it cannot read.
 *
 * A backup transport and a file store keep their blobs the same way, in a folder, a bucket or on an SFTP server, and
 * tell their users apart by this alone.
 */
export type StorageNaming = {
    /**
     * The store as a message names it, such as `transport "nightly"`.
     */
    readonly subject: string,
    /**
     * Resolves the `/`-separated segments of a key.
     * @throws When a segment could lead outside where the store keeps its blobs.
     */
    readonly resolveKeySegments: (key: string) => string[],
    /**
     * Creates the error for a key that holds nothing.
     */
    readonly createKeyNotFoundError: (key: string) => Error,
    /**
     * Creates the error for a key the store may not read.
     */
    readonly createKeyAccessDeniedError: (key: string, cause: unknown) => Error
};