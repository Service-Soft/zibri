import { BackupEntity } from './backup-entity.model';
import { READABLE_BACKUP_FORMAT_VERSIONS } from './backup-format';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a backup written in a shape this build does not read.
 */
export class UnreadableBackupError extends InternalError {
    constructor(backup: BackupEntity) {
        super([
            `The backup "${backup.name}" is written in backup format ${backup.formatVersion},`,
            `and this build reads ${READABLE_BACKUP_FORMAT_VERSIONS.join(', ')}.`,
            `It was taken by zibri ${backup.zibriVersion}.`
        ]);
        this.name = 'UnreadableBackupError';
    }
}