import { BackupResourceInterface } from './backup-resource.interface';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a backup resource that no transport takes.
 */
export class BackupTransportNotFoundError extends InternalError {
    constructor(backupResource: BackupResourceInterface) {
        super(`Could not find a transport for the backup resource "${backupResource.constructor.name}"`);
        this.name = 'BackupTransportNotFoundError';
    }
}