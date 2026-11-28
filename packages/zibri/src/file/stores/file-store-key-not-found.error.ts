import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error for a key of a file store that holds nothing.
 */
export class FileStoreKeyNotFoundError extends InternalError {
    /**
     * Creates the error for the key that holds nothing.
     * @param storeName - The name of the file store.
     * @param key - The key.
     */
    constructor(storeName: string, readonly key: string) {
        super(`The file store "${storeName}" holds nothing under "${key}".`);
        this.name = 'FileStoreKeyNotFoundError';
    }
}