import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error for a key of a backup transport that the transport may not read, such as a file whose permissions do
 * not let the application read it.
 */
export class BackupKeyAccessDeniedError extends InternalError {
    /**
     * Creates the error for the key the transport may not read.
     * @param transportName - The name of the transport.
     * @param key - The key.
     * @param cause - What the transport was answered.
     */
    constructor(transportName: string, readonly key: string, cause: unknown) {
        super(`The backup transport "${transportName}" may not read "${key}".`, { cause });
        this.name = 'BackupKeyAccessDeniedError';
    }
}