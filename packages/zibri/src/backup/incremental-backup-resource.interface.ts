import { Readable } from 'node:stream';

import { BackupDataOptions } from './backup-data-options.model';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceInterface, isBackupResource } from './backup-resource.interface';
import { IncrementalBackupData } from './incremental-backup-data.model';

/**
 * A backup resource that can read only what changed since an earlier backup of it.
 *
 * A backup of it holds either the resource in full or what changed since the backup it builds on. A
 * restore applies the newest backup in full that the restored one builds on, and each backup after it
 * up to the restored one, in order.
 */
export interface IncrementalBackupResourceInterface extends BackupResourceInterface {
    /**
     * Whether backups read only what changed. When false, every backup reads the resource in full
     * through `createBackupData`, while backups that read only what changed stay restorable.
     */
    readonly incrementalRead: boolean,
    /**
     * Reads the resource for a backup: what changed since the cursor, or in full.
     * @param backup - The backup being taken.
     * @param options - What the backup does with the data.
     * @param since - The cursor of the backup this one builds on, or undefined to read in full.
     */
    createIncrementalBackupData: (
        backup: BackupEntity,
        options: BackupDataOptions,
        since: string | undefined
    ) => Promise<IncrementalBackupData>,
    /**
     * Called once the backup that read up to the cursor completed: the next backup reads on from there.
     * @param cursor - The cursor that backup was handed back.
     */
    confirmReadCursor: (cursor: string) => Promise<void>,
    /**
     * Forgets where backups read on from, once the resource's data was replaced: the next backup reads
     * in full.
     */
    forgetReadCursor: () => Promise<void>,
    /**
     * Restores the resource to a backup in full and the backups after it, in order, entirely or not at all.
     * @param full - The data of the backup in full.
     * @param increments - The data of each backup after it, the oldest first.
     */
    restoreIncrementalBackup: (full: Readable, increments: Readable[]) => Promise<void>
}

/**
 * Checks whether a backup resource can read only what changed.
 * @param value - The resource.
 * @returns Whether it implements IncrementalBackupResourceInterface.
 */
export function isIncrementalBackupResource(value: unknown): value is IncrementalBackupResourceInterface {
    const keys: (keyof IncrementalBackupResourceInterface)[] = [
        'incrementalRead',
        'createIncrementalBackupData',
        'confirmReadCursor',
        'forgetReadCursor',
        'restoreIncrementalBackup'
    ];
    return isBackupResource(value) && keys.every(key => key in value);
}