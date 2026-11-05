import { BackupEntity } from './backup-entity.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for waiting on a backup that stopped because the application is shutting down.
 */
export class BackupStoppedError extends InternalError {
    constructor(backup: BackupEntity) {
        super(
            `Waiting for the backup "${backup.name}" stopped because the application is shutting down. `
            + 'Another instance stores what is left of it.'
        );
        this.name = 'BackupStoppedError';
    }
}