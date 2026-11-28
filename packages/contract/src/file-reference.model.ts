/**
 * A file of an entity the backend keeps in a file store, as a response answers with it: what the file is, and where
 * a browser downloads its bytes from.
 */
export type FileReference = {
    /**
     * The name of the file, like 'receipt.pdf'.
     */
    name: string,
    /**
     * The mime type of the file, like 'application/pdf'.
     */
    mimeType: string,
    /**
     * The size of the file in bytes.
     */
    size: number,
    /**
     * Where a browser downloads the bytes from, the download route of the entity's `CrudController`. Null when no
     * `CrudController` serves the entity.
     */
    url?: string | null
};