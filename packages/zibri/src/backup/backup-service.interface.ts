import { Readable } from 'node:stream';

import { BehaviorSubject } from 'rxjs';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { OmitStrict } from '../types/omit-strict.type';
import { BackupTransportInterface } from './transports/backup-transport.interface';

/**
 * The data needed to create a new backup.
 */
export type BackupCreateData = OmitStrict<BackupEntityCreateData, 'resources' | 'masterKeys' | 'dataKeyIds' | 'status'>;

/**
 * Interface for a backup service.
 */
export interface BackupServiceInterface {
    /**
     * A subject that contains whether or not a backup is currently being created.
     */
    isCreatingBackup: BehaviorSubject<boolean>,
    /**
     * A subject that contains whether or not a backup is currently being restored.
     */
    isRestoringBackup: BehaviorSubject<boolean>,
    /**
     * Synchronizes backup entities with the data from all transports.
     *
     * Fails when a transport cannot be read. The sync that runs while the application starts skips such a
     * transport with a warning instead.
     */
    syncBackupEntities: () => Promise<void>,
    /**
     * Queues a new backup based on the given configuration, and starts storing its resources on this
     * instance.
     * @returns The backup, `RUNNING`. `waitForBackup` waits for it to complete.
     */
    queueBackup: (data?: BackupCreateData) => Promise<BackupEntity>,
    /**
     * Waits for a backup to complete, whichever instance stores its resources.
     * @returns The backup, `COMPLETED`.
     * @throws A BackupFailedError when a resource spent its attempts without being stored.
     */
    waitForBackup: (backup: BackupEntity) => Promise<BackupEntity>,
    /**
     * Stores the resources of queued backups that are due on this instance: those nobody else is
     * storing, and those whose retry is due.
     * @returns Whether a resource was stored or tried.
     */
    runQueuedBackups: () => Promise<boolean>,
    /**
     * Restores the given backup.
     */
    restore: (backup: BackupEntity) => Promise<void>,
    /**
     * Deletes the given backup.
     */
    delete: (backup: BackupEntity) => Promise<void>,
    /**
     * Resolves a backup resource based on the given entity.
     */
    resolveBackupResource: (
        resource: BackupResourceEntity
    ) => BackupResourceInterface | undefined | Promise<BackupResourceInterface | undefined>,
    /**
     * Resolve the transports for the given backup resource.
     */
    resolveTransports: (
        resource: BackupResourceEntity
    ) => BackupTransportInterface[] | undefined | Promise<BackupTransportInterface[] | undefined>,
    /**
     * Resolves the actual backed up data for the given resource and transports.
     */
    resolveData: (
        transports: BackupTransportInterface[],
        resource: BackupResourceEntity,
        backup: BackupEntity
    ) => Readable | Promise<Readable>,
    /**
     * Resolves every backup recorded in the database, or none when the application backs nothing up.
     */
    resolveRecordedBackups: () => Promise<BackupEntity[]>
}