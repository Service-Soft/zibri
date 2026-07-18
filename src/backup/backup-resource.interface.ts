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
    restoreBackup: (backupData: Readable) => void | Promise<void>,
    /**
     * Validates that the resource is ready to be backed up.
     *
     * This can be used to eg. Verify that a postgres datasource has the rootUsername and rootPw set.
     */
    validateBackupConfiguration: () => void | Promise<void>
}

/**
 * Checks whether or not the given value is a user repository.
 * @param value - The value to check.
 * @returns True if the value has all the keys of UserRepositoryInterface, false otherwise.
 */
export function isBackupResource(value: unknown): value is BackupResourceInterface {
    const keys: (keyof BackupResourceInterface)[] = [
        'validateBackupConfiguration',
        'createBackupData',
        'restoreBackup'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}