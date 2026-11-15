/**
 * A file the backend stored, like an attachment or a picture, as its routes answer with it. Where and how it is stored
 * is up to the backend, the url is where a browser loads it from.
 */
export type StoredFile = {
    /**
     * The id of the file.
     */
    id: string,
    /**
     * The name of the file, like 'invoice.pdf'.
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
     * Where a browser loads the file from, like a route of the backend or a signed url of a storage.
     */
    url: string
};