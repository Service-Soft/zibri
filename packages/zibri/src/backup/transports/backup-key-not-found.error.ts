import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error for a key of a backup transport that holds nothing.
 */
export class BackupKeyNotFoundError extends InternalError {
    /**
     * Creates the error for the key that holds nothing.
     * @param transportName - The name of the transport.
     * @param key - The key.
     */
    constructor(transportName: string, readonly key: string) {
        super(`The backup transport "${transportName}" holds nothing under "${key}".`);
        this.name = 'BackupKeyNotFoundError';
    }
}