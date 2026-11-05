import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a backup service that cannot start: a resource without a transport, a transport
 * that cannot be reached, or a retention nothing declares.
 */
export class InitBackupServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing backup service.', ...messageArray]);
        this.name = 'InitBackupServiceError';
    }
}