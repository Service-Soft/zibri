import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupDigest } from './staging.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for stored backup data that is not what the backup recorded writing.
 */
export class CorruptBackupError extends InternalError {
    constructor(backup: BackupEntity, resource: BackupResourceEntity, found: BackupDigest) {
        super([
            `The stored data of resource "${resource.name}" is not the data backup "${backup.name}" recorded.`,
            `Expected ${resource.size} bytes with checksum ${resource.checksum}.`,
            `Found ${found.size} bytes with checksum ${found.checksum}.`
        ]);
        this.name = 'CorruptBackupError';
    }
}