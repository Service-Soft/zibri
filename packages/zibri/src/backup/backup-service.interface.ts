import { Readable } from 'node:stream';

import { BehaviorSubject } from 'rxjs';

import { OmitStrict } from '../types/omit-strict.type';
import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupRetention } from './backup-retention.model';
import { RestoreOptions } from './restore-options.model';
import { TenantBackupTransport, TenantBackupTransportCreateData } from './tenant/tenant-backup-transport.model';
import { TenantExportFormat } from './tenant-export-format.type';
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
     * Restores the given backup. Refused with a `NotEnoughRestoreSpaceError` before anything is fetched when
     * this instance's disk is too small for it, which names what it needs and what to do.
     */
    restore: (backup: BackupEntity, options?: RestoreOptions) => Promise<void>,
    /**
     * Deletes the given backup.
     */
    delete: (backup: BackupEntity) => Promise<void>,
    // TODO 4.0: required
    /**
     * Deletes what the transports hold that no backup needs any more, such as the chunks only deleted
     * backups named, and checks a share of the rest when `ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS` says so.
     *
     * Returns at once when another instance is collecting. Resources stored meanwhile wait for it in
     * short pauses.
     * @throws When the garbage of a transport could not be collected. The others are collected regardless.
     */
    collectGarbage?: () => Promise<void>,
    // TODO 4.0: required
    /**
     * Exports the rows of a tenant as the application answers them, readable without the application: a
     * tar archive holding `manifest.json` and a file per entity, in JSON lines or CSV. Encrypted values
     * are decrypted, and hashed and excluded properties left out.
     * @param tenantId - The tenant.
     * @param format - How the rows are written.
     * @returns The archive, as it is written.
     */
    exportTenant?: (tenantId: string, format: TenantExportFormat) => Readable | Promise<Readable>,
    // TODO 4.0: required
    /**
     * Adds a transport a tenant's backups go to: a bucket over https or an SFTP server, at a public address.
     * A small object is written and deleted on it first.
     * @param tenantId - The tenant.
     * @param data - The transport, with its secret.
     * @returns The transport, stored.
     * @throws A BadRequestError when it is not one the application allows, or cannot be written to.
     */
    createTenantBackupTransport?: (tenantId: string, data: TenantBackupTransportCreateData) => Promise<TenantBackupTransport>,
    // TODO 4.0: required
    /**
     * Finds the transports of a tenant.
     * @param tenantId - The tenant.
     * @returns The transports.
     */
    findTenantBackupTransports?: (tenantId: string) => Promise<TenantBackupTransport[]>,
    // TODO 4.0: required
    /**
     * Deletes a transport of a tenant.
     * @param tenantId - The tenant.
     * @param id - The transport.
     * @throws A ConflictError while a backup is stored on it.
     */
    deleteTenantBackupTransport?: (tenantId: string, id: string) => Promise<void>,
    // TODO 4.0: required
    /**
     * Sets which of a tenant's backups are kept, in place of `ZIBRI_DI_TOKENS.BACKUP_RETENTION`.
     * @param tenantId - The tenant.
     * @param retention - The retention, or undefined for the application's.
     */
    setTenantBackupRetention?: (tenantId: string, retention: BackupRetention | undefined) => Promise<void>,
    // TODO 4.0: required
    /**
     * Records every backup the transports of a tenant hold that is not recorded yet, such as after the
     * database was restored. A record of another tenant, or naming a transport that is not the tenant's, is
     * skipped with a warning.
     * @param tenantId - The tenant.
     * @throws When a transport of the tenant cannot be reached.
     */
    syncTenantBackupEntities?: (tenantId: string) => Promise<void>,
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
    // TODO 4.0: transports of v2 only
    ) => BackupTransportInterface[] | undefined | Promise<BackupTransportInterface[] | undefined>,
    /**
     * Resolves the actual backed up data for the given resource and transports.
     */
    resolveData: (
        // TODO 4.0: transports of v2 only
        transports: BackupTransportInterface[],
        resource: BackupResourceEntity,
        backup: BackupEntity
    ) => Readable | Promise<Readable>,
    /**
     * Resolves every backup recorded in the database, or none when the application backs nothing up.
     */
    resolveRecordedBackups: () => Promise<BackupEntity[]>
}