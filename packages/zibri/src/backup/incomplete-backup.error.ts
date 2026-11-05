import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a backup whose resource was never finished being written, so there is nothing to
 * restore from.
 */
export class IncompleteBackupError extends InternalError {
    constructor(backup: BackupEntity, resource: BackupResourceEntity) {
        super([
            `The resource "${resource.name}" of backup "${backup.name}" was never finished.`,
            'Whatever is stored for it is part of a backup rather than one, so there is nothing to restore from.'
        ]);
        this.name = 'IncompleteBackupError';
    }
}