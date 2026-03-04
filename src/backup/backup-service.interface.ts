import { Readable } from 'node:stream';

import { BehaviorSubject } from 'rxjs';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';
import { BackupTransportInterface } from './transports/backup-transport.interface';

/**
 * The data needed to create a new backup.
 */
export type BackupCreateData = OmitStrict<BackupEntityCreateData, 'resources'>;

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
     * Initializes the service.
     */
    init: () => void | Promise<void>,
    /**
     * Synchronizes backup entities with the data from all transports.
     */
    syncBackupEntities: () => Promise<void>,
    /**
     * Starts a new backup based on the given configuration.
     */
    createBackup: (data?: BackupCreateData) => Promise<void>,
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
    ) => Newable<BackupResourceInterface> | undefined | Promise<Newable<BackupResourceInterface> | undefined>,
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
    ) => Readable | Promise<Readable>
}