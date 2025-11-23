import { Readable } from 'node:stream';

import { BackupEntity } from './backup-entity.model';

/**
 * Interface that needs to be implemented by any resource that should be backed up.
 */
export interface BackupResourceInterface {
    /**
     * Creates the data that should be backed up in form of a Readable stream.
     */
    createBackupData: (backup: BackupEntity) => Readable | Promise<Readable>,
    /**
     * Restores this resource to the the given backup data.
     */
    restoreBackup: (backupData: Readable) => void | Promise<void>
}