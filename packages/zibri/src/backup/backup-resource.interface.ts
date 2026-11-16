import { Readable } from 'node:stream';

import { BackupDataOptions } from './backup-data-options.model';
import { BackupEntity } from './backup-entity.model';

/**
 * Interface that needs to be implemented by any resource that should be backed up.
 */
export interface BackupResourceInterface {
    /**
     * Creates the data that should be backed up in form of a Readable stream.
     * @param backup - The backup being taken.
     * @param options - What the backup does with the data, such as cutting it into chunks.
     */
    createBackupData: (backup: BackupEntity, options: BackupDataOptions) => Readable | Promise<Readable>,
    /**
     * Restores this resource to the the given backup data.
     * @param backupData - The data.
     * @param reopenBackupData - Reads the same data again from its start, for a restore that reads it more
     * than once.
     */
    // TODO 4.0: reopenBackupData required
    restoreBackup: (backupData: Readable, reopenBackupData?: () => Readable) => void | Promise<void>,
    /**
     * Validates that the resource is ready to be backed up.
     *
     * This can be used to eg. Verify that a postgres datasource has the rootUsername and rootPw set.
     */
    validateBackupConfiguration: () => void | Promise<void>,
    /**
     * Whether restoring the given data changes everything or nothing by itself, so that a restore of
     * this resource alone keeps no copy of what it holds now to put back, and needs half the disk.
     * Undefined counts as false.
     * @param backupData - The data the restore applies: in full, of a resource that reads only what changed.
     * @param increments - What changed since, of each backup after it up to the one restored, in order. None
     * for a backup in full.
     */
    resolveRestoresWhole?: (backupData: Readable, increments: Readable[]) => Promise<boolean>,
    /**
     * Deletes what a backup takes of the resource, before a restore with `deleteFirst` applies the backup, so
     * that its server needs room for the backup alone. What a backup leaves out stays, such as the rows of an
     * entity declared `backedUp: false`. Without it, a restore with `deleteFirst` is refused.
     */
    deleteBackedUpData?: () => Promise<void>
}

/**
 * Checks whether or not the given value is a backup resource.
 * @param value - The value to check.
 * @returns True if the value has all the keys of BackupResourceInterface, false otherwise.
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