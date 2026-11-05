import { BackupEntity } from './backup-entity.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a restore that was stopped because the application is shutting down.
 */
export class RestoreStoppedError extends InternalError {
    constructor(backup: BackupEntity) {
        super(`The restore of backup "${backup.name}" was stopped because the application is shutting down.`);
        this.name = 'RestoreStoppedError';
    }
}