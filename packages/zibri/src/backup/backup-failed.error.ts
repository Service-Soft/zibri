import { BackupEntity } from './backup-entity.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * What waiting for a backup fails with when a resource of it spent its attempts without being stored.
 */
export class BackupFailedError extends InternalError {
    constructor(backup: BackupEntity) {
        const failed: string[] = backup.resources
            .filter(r => !r.completed && r.error != undefined)
            .map(r => `The resource "${r.name}" was not stored after ${r.attempts} attempts: ${r.error?.paragraphs.join(' ')}`);
        super([`The backup "${backup.name}" failed.`, ...failed]);
        this.name = 'BackupFailedError';
    }
}