import { Readable } from 'node:stream';

/**
 * What `FileService.store` stores: the bytes of a file, what it is, and the store it goes to.
 */
export type StoreFileData = {
    /**
     * The name of the file store, such as `'documents'`. A store the current tenant configured under this name is
     * used before the application's own.
     */
    store: string,
    /**
     * The name of the file, such as `invoice-2026-11.pdf`.
     */
    name: string,
    /**
     * The mime type of the file, such as `application/pdf`.
     */
    mimeType: string,
    /**
     * The bytes. A stream is written to a temporary file while it is hashed, so it is never held in memory as a whole.
     */
    data: Buffer | Readable,
    /**
     * The id of the user who stores the file. Defaults to the user of the current request, if any.
     */
    createdBy?: string
};