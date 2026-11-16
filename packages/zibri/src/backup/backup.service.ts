// TODO 4.0: drop, with v1 of BackupTransportInterface. Until then a transport supports v1 or v2, which the
// service tells apart wherever it stores, fetches or names one
/* eslint-disable typescript/no-deprecated */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout } from 'node:timers/promises';

import { BehaviorSubject, first, firstValueFrom } from 'rxjs';

import { BackupChunkEntity } from './backup-chunk-entity.model';
import { BackupDataOptions } from './backup-data-options.model';
import { BackupDigest } from './backup-digest.model';
import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupFailedError } from './backup-failed.error';
import { BACKUP_REPOSITORY_FOLDER, READABLE_BACKUP_FORMAT_VERSIONS } from './backup-format';
import { BackupGarbageCollectionCronJob } from './backup-garbage-collection.cron-job';
import { BackupPeriod } from './backup-period.type';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BackupResourceInterface, isBackupResource } from './backup-resource.interface';
import { BackupRetention } from './backup-retention.model';
import { BackupRetentionUtilities } from './backup-retention.utilities';
import { BackupCreateData, BackupServiceInterface } from './backup-service.interface';
import { BackupStagingCleanupCronJob } from './backup-staging-cleanup.cron-job';
import { BackupStatus } from './backup-status.enum';
import { BackupStoppedError } from './backup-stopped.error';
import { BackupTransportNotFoundError } from './backup-transport-not-found.error';
import { CorruptBackupError } from './corrupt-backup.error';
import { BackupResourceMetadata } from './decorators/backup-resource-metadata.model';
import { IncompleteBackupError } from './incomplete-backup.error';
import { IncrementalBackupData } from './incremental-backup-data.model';
import { IncrementalBackupResourceInterface, isIncrementalBackupResource } from './incremental-backup-resource.interface';
import { InitBackupServiceError } from './init-backup-service.error';
import { KeptUserRowsUtilities } from './kept-user-rows.utilities';
import { NotEnoughRestoreSpaceError } from './not-enough-restore-space.error';
import { BackupChunkUtilities } from './repository/backup-chunk.utilities';
import { BackupChunkingUtilities } from './repository/backup-chunking.utilities';
import { BackupRepositoryKey } from './repository/backup-repository-key.model';
import { BackupScrubOptions } from './repository/backup-scrub-options.model';
import { Format2BackupGarbageCollector } from './repository/format-2.backup-garbage-collector';
import { Format2BackupLayout } from './repository/format-2.backup-layout';
import { RetrievedBackupResource } from './repository/retrieved-backup-resource.model';
import { RestoreJournalEntry } from './restore-journal-entry.model';
import { RestoreJournal } from './restore-journal.model';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { RestoreNotUndoneError } from './restore-not-undone.error';
import { RestoreOptions } from './restore-options.model';
import { RestoreSpace, RestoreSpaceOfResource } from './restore-space.model';
import { RestoreStoppedError } from './restore-stopped.error';
import { RunQueuedBackupsCronJob } from './run-queued-backups.cron-job';
import { StagedChunksFile } from './staged-chunks-file.model';
import { StagedFileCompression } from './staged-file-compression.type';
import { StagedFile } from './staged-file.model';
import { StagingUtilities } from './staging.utilities';
import { TenantBackupSettings } from './tenant/tenant-backup-settings.model';
import { AnyTenantBackupTransportKind } from './tenant/tenant-backup-transport-kind.interface';
import { TenantBackupTransportOptions } from './tenant/tenant-backup-transport-options.model';
import { TenantBackupTransport, TenantBackupTransportCreateData } from './tenant/tenant-backup-transport.model';
import { TENANT_TRANSPORT_NAME_PREFIX, TenantRowBackupTransport } from './tenant/tenant-row.backup-transport';
import { TenantExportFormat } from './tenant-export-format.type';
import { TenantExportUtilities } from './tenant-export.utilities';
import { TenantRowsBackupResource } from './tenant-rows.backup-resource';
import { BackupKeyNotFoundError } from './transports/backup-key-not-found.error';
import { BackupTransportSessionInterface } from './transports/backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportSupporting, BackupTransportVersionMembers, isBackupTransport } from './transports/backup-transport.interface';
import { BaseFsBackupTransport } from './transports/base-fs.backup-transport';
import { BaseS3BackupTransport } from './transports/base-s3.backup-transport';
import { BaseSftpBackupTransport } from './transports/base-sftp.backup-transport';
import { BaseBackupTransport } from './transports/base.backup-transport';
import { Format1BackupTransport } from './transports/format-1.backup-transport';
import { UnreadableBackupError } from './unreadable-backup.error';
import { ZibriApplication } from '../application/application';
import { type AuditServiceInterface } from '../audit/audit-service.interface';
import { EncryptionKey } from '../auth/encryption/encryption-key.model';
import { type EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { KeptEncryptionKeys } from '../auth/encryption/kept-encryption-keys.model';
import { KeysInUse } from '../auth/encryption/keys-in-use.model';
import { SigningKey } from '../auth/encryption/signing-key.model';
import { EncryptionStrategyEntity } from '../auth/encryption/strategies/encryption-strategy-entity.model';
import { type UserServiceInterface } from '../auth/user/user-service.interface';
import { CacheRestoreTagUtilities } from '../caching/cache-restore-tag.utilities';
import { type CacheServiceInterface } from '../caching/cache-service.interface';
import { DataSourceInterface, isDataSource } from '../data-source/data-sources/data-source.interface';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { MimeType } from '../http/mime-type.enum';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { $ts } from '../localization/translate.function';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model';
import { AuditUtilities } from '../logging/audit.utilities';
import { type LoggerInterface } from '../logging/logger.interface';
import { parseObject } from '../parsing/functions/parse-object.function';
import { WakeUpListener } from '../polling/wake-up-listener.model';
import { type WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { QueueDefinition } from '../queue/queue-definition.model';
import { QueueUtilities } from '../queue/queue.utilities';
import { QueuedWorkHandedBackError } from '../queue/queued-work-handed-back.error';
import { QueuedWorkOutcome } from '../queue/queued-work-outcome.model';
import { resolveStructuredBodyMetadata } from '../routing/resolve-body-metadata.function';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities, TimeoutError } from '../utilities/promise.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { type ValidationServiceInterface } from '../validation/validation-service.interface';

/**
 * How long storing a resource waits for a restore or another backup of it to be done, before the
 * attempt fails and is tried again after the retry delay.
 */
const RESOURCE_WAIT_IN_MS: number = Ms.MINUTE;

/**
 * How long a garbage collection waits for a pause in which no resource is being stored, before it leaves
 * the transport to the next collection.
 */
const GARBAGE_COLLECTION_WAIT_IN_MS: number = Ms.HOUR;

/**
 * How long a garbage collection waits before it looks for a pause again.
 */
const GARBAGE_COLLECTION_RETRY_IN_MS: number = Ms.SECOND * 5;

/**
 * How long a garbage collection waits between two windows: longer than a resource waiting for its lease
 * takes to try again, which is a second at most.
 */
const GARBAGE_COLLECTION_PAUSE_IN_MS: number = Ms.SECOND * 2;

/**
 * How often a resource that reads only what changed reads in full, when the retention does not say.
 */
const DEFAULT_FULL_READ: BackupPeriod = 'weekly';

/**
 * How a restore stores on this instance's disk the data it fetched and the snapshots it keeps to put back.
 */
const RESTORE_STAGING_COMPRESSION: StagedFileCompression = 'zstd';

/**
 * What a resource records of how it was read: the backup it builds on, and where the next one reads on from.
 */
type ResourceReadRecord = Pick<BackupResourceEntity, 'baseBackupId' | 'readCursor'>;

/**
 * What a resource records once every transport took it: its size, its checksum, the key its data is
 * encrypted with, if any, and how it was read.
 */
type StoredResourceRecord = BackupDigest & ResourceReadRecord & {
    /**
     * The key the resource's data is encrypted with, itself encrypted, or undefined when the data is not encrypted.
     */
    encryptedKey: EncryptionString | undefined,
    /**
     * The size of the resource's data as staged on this instance's disk, if it was staged.
     */
    stagedSize: number | undefined
};

/**
 * The data of a resource read for a backup, and how it was read.
 */
type ReadResourceData = {
    /**
     * The data the resource read.
     */
    data: Readable,
    /**
     * How the resource read it.
     */
    record: ResourceReadRecord
};

/**
 * One backup of a resource on the way to the one restored: the backup, and the resource as it records it.
 */
type ChainLink = {
    /**
     * The backup this link belongs to.
     */
    backup: BackupEntity,
    /**
     * The resource as the backup records it.
     */
    resource: BackupResourceEntity
};

/**
 * What a garbage collection's window turned out: taken and the work done, or not taken.
 */
type GarbageCollectionWindowOutcome<T> = {
    /**
     * The window was taken.
     */
    taken: true,
    /**
     * What the work done in the window returned.
     */
    value: T
} | {
    /**
     * The window was not taken.
     */
    taken: false
};

/**
 * A resource of a backup being restored, whose data is fetched, checked and waiting on this instance's disk.
 */
type StagedResource = {
    /**
     * The resource as the backup records it.
     */
    entity: BackupResourceEntity,
    /**
     * The resource the data is applied to.
     */
    resource: BackupResourceInterface,
    /**
     * Where its data waits: of the backup restored, or of the newest backup in full it builds on.
     */
    data: StagedFile | StagedChunksFile,
    /**
     * Where the data of each backup after that one waits, up to the one restored, the oldest first. Empty
     * for a backup holding the resource in full.
     */
    increments: (StagedFile | StagedChunksFile)[],
    /**
     * Where what the resource held before the restore is kept until the restore is done.
     */
    snapshot: StagedFile
};

/**
 * The encryption keys a restore keeps beside those of the backup.
 */
type KeysAcrossRestore = {
    /**
     * The keys stored when the restore began.
     */
    kept: KeptEncryptionKeys,
    /**
     * Whether a data source holding them may have been replaced since they were last written back.
     */
    pending: boolean
};

/**
 * The rows of the users that exist when a restore begins, which it keeps of a data source it replaces
 * holding entities declared `backedUp: 'keptForCurrentUsers'`.
 */
type UserRowsAcrossRestore = {
    /**
     * The data source.
     */
    resource: BackupResourceInterface,
    /**
     * Where the rows are kept until the restore is done.
     */
    file: StagedFile,
    /**
     * The rows as the journal names them.
     */
    entry: RestoreJournalEntry,
    /**
     * Whether the data source may have been replaced since they were last written back.
     */
    pending: boolean
};

/**
 * A staged resource whose snapshot is written.
 */
type SnapshottedResource = StagedResource & {
    /**
     * What the snapshot held when it was written, or undefined when none was, for a resource whose restore
     * changes everything or nothing by itself.
     */
    snapshotDigest: BackupDigest | undefined
};

/**
 * As much of a stored record as this build can count on reading.
 *
 * Only the one field, because every other field is read in whatever shape this one names - so it is
 * the one that has to mean the same thing in every shape there will ever be.
 */
type VersionedBackupDocument = {
    /**
     * What shape the rest of the record is written in.
     */
    formatVersion: unknown
};

/**
 * Default implementation of the backup service.
 */
@Injectable({ register: 'onUse' })
export class BackupService implements BackupServiceInterface, OnAppInit, AfterAppInit, OnAppShutdown {
    private readonly backupResources: BackupResourceInterface[] = [];
    private readonly format1Transports: WeakMap<BackupTransportSupporting<'v2'>, BackupTransportInterface> = new WeakMap();
    // whether a data source declares the chunk index, which a backup otherwise reads off its transports
    private chunkIndexDeclared: boolean = false;
    // every data source of the application, whose rows of a tenant its export holds, marked with @Backup or not
    private dataSources: DataSourceInterface[] = [];
    // whether a data source declares the entities tenants configure their transports and retention in
    private tenantTransportsDeclared: boolean = false;
    private tenantSettingsDeclared: boolean = false;
    // the same transport each time for a tenant's transport, by the id of its row: the record is stored
    // once per transport a backup went to, which is told apart by identity
    private readonly tenantTransports: Map<string, BackupTransportInterface> = new Map();
    // when the last window of a garbage collection on this instance ended, which the next one waits a pause after
    private garbageCollectionWindowEndedAt: number = 0;
    // the sync of the transports of tenants that the start leaves running, and what stops it before its next tenant
    private tenantSyncAtStart: Promise<void> = Promise.resolve();
    private readonly tenantSyncStopping: AbortController = new AbortController();
    private readonly format2: Format2BackupLayout = new Format2BackupLayout(
        () => this.chunkIndexDeclared ? inject(repositoryTokenFor(BackupChunkEntity)) : undefined
    );
    private readonly garbageCollector: Format2BackupGarbageCollector = new Format2BackupGarbageCollector(
        this.format2,
        () => this.chunkIndexDeclared ? inject(repositoryTokenFor(BackupChunkEntity)) : undefined
    );

    private get backupRepository(): Repository<BackupEntity, BackupEntityCreateData> {
        return inject(repositoryTokenFor(BackupEntity));
    }

    private get backupResourceRepository(): Repository<BackupResourceEntity, BackupResourceEntityCreateData> {
        return inject(repositoryTokenFor(BackupResourceEntity));
    }

    private get stagingFolder(): FsPath {
        return inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
    }

    // a backup's key is encrypted with the master key rather than a key of its own: both would come
    // from the same place, so whoever can read one can read the other, and a second key would only be
    // a second thing to rotate. Not a key from the key table either, since that table is restored
    // with everything else
    private get encryptionService(): EncryptionServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly isCreatingBackup: BehaviorSubject<boolean> = new BehaviorSubject(false);

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly isRestoringBackup: BehaviorSubject<boolean> = new BehaviorSubject(false);

    // eslint-disable-next-line jsdoc/require-jsdoc
    get shutdownTimeoutInMs(): number {
        return this.shutdownWaitInMs + inject(ZIBRI_DI_TOKENS.BACKUP_STOPPING_TIMEOUT_IN_MS);
    }

    // aborted when the application stops waiting for a running backup or restore. Never reset: a
    // service whose application is shutting down starts nothing new
    private readonly stopping: AbortController = new AbortController();

    /**
     * How many passes over the queued backups this instance is running right now. A backup is being
     * created here until the last of them is over, recording and completing included.
     */
    private runningPasses: number = 0;

    /**
     * Who waits on this instance for a backup to end, by its id: told by the instance that ends it
     * here with the backup as it ended, without reading it again.
     */
    private readonly waiting: Map<string, Set<(backup: BackupEntity) => void>> = new Map();

    private get wakeUpService(): WakeUpServiceInterface {
        return inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    private get retention(): BackupRetention | undefined {
        return inject(ZIBRI_DI_TOKENS.BACKUP_RETENTION);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS)
        private readonly shutdownWaitInMs: number
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        this.dataSources = app.options.dataSources.map(d => inject(d));
        this.tenantTransportsDeclared = this.dataSources.some(d => d.entities.includes(TenantBackupTransport));
        this.tenantSettingsDeclared = this.dataSources.some(d => d.entities.includes(TenantBackupSettings));
        const backupResources: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.BACKUP_RESOURCE);
        if (backupResources.length) {
            this.addBackupCronJobs(app);
            // eslint-disable-next-line stylistic/max-len
            this.logger.info(`configures ${backupResources.length} ${backupResources.length > 1 ? 'resources' : 'resource'} to be backed up:`);
            validateEntitiesRegistered(BackupService.name, app, BackupResourceEntity, BackupEntity);
            this.validateBackupOptions();
            this.chunkIndexDeclared = app.options.dataSources.some(d => inject(d).entities.includes(BackupChunkEntity));
        }
        const retention: BackupRetention | undefined = this.retention;
        if (retention != undefined) {
            BackupRetentionUtilities.validateRetention(retention);
        }

        for (const provider of backupResources) {
            await this.registerBackupResource(provider, retention);
        }
        if (backupResources.length) {
            this.warnAboutFormat1Transports();
            // TODO 4.0: required, as BackupEntity is
            if (!this.chunkIndexDeclared && this.resolveRegisteredTransports().some(t => this.findStore(t) != undefined)) {
                this.logger.warn(
                    'No data source declares BackupChunkEntity, so each resource a backup stores first lists every chunk its '
                    + 'transports hold. Declare it beside BackupEntity.'
                );
            }
        }

        // We DON'T do this here because things like data sources implement BackupResourceInterface but might not use them.
        // const resources: BackupResourceInterface[] = getAllRegisteredTokens()
        //     .map(t => inject(t))
        //     .filter(i => isBackupResource(i));
        // for (const resource of resources) {
        //     if (!this.backupResources.find(c => c.constructor.name === resource.constructor.name)) {
        //         throw new InitBackupServiceError(
        //             `The class "${resource.constructor.name}" seems to be a backup resource but has not been decorated with @Backup()`
        //         );
        //     }
        // }
    }

    /**
     * Adds the cron jobs that backups need to the application, unless it already runs them.
     * @param app - The application being initialized.
     */
    private addBackupCronJobs(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(BackupStagingCleanupCronJob)) {
            app.options.cronJobs.push(BackupStagingCleanupCronJob);
        }
        if (!app.options.cronJobs.includes(RunQueuedBackupsCronJob)) {
            app.options.cronJobs.push(RunQueuedBackupsCronJob);
        }
        // only a blob store holds chunks
        if (this.resolveRegisteredTransports().some(t => this.findStore(t) != undefined)
            && !app.options.cronJobs.includes(BackupGarbageCollectionCronJob)) {
            app.options.cronJobs.push(BackupGarbageCollectionCronJob);
        }
    }

    /**
     * Checks the options backups run with: how many resources are stored at once, how data is chunked and how
     * stored chunks are scrubbed.
     * @throws {InitBackupServiceError} When fewer than one resource would be stored at once.
     */
    private validateBackupOptions(): void {
        const maxConcurrent: number = inject(ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES);
        // anything less stores nothing, without a word about why
        if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
            throw new InitBackupServiceError(
                `ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES needs to be a whole number of at least 1, not ${maxConcurrent}`
            );
        }
        BackupChunkingUtilities.validateOptions(inject(ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS));
        const scrub: BackupScrubOptions | undefined = inject(ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS);
        if (scrub != undefined) {
            Format2BackupGarbageCollector.validateScrubOptions(scrub);
        }
    }

    /**
     * Checks a provider marked with "@Backup" and adds it to the resources that are backed up.
     * @param provider - The provider marked with @Backup.
     * @param retention - The backup retention, if one is configured.
     * @throws {InitBackupServiceError} When the provider is no backup resource, or names no transport.
     */
    private async registerBackupResource(provider: DiProvider<unknown>, retention: BackupRetention | undefined): Promise<void> {
        const resource: unknown = inject(provider.token);
        if (!isBackupResource(resource)) {
            throw new InitBackupServiceError(
                `Invalid resource marked with @Backup: ${getDiTokenName(provider.token)} needs to implement BackupResourceInterface`
            );
        }
        await resource.validateBackupConfiguration();
        for (const [entity, keptWith] of KeptUserRowsUtilities.findKeptWithoutOwner(resource)) {
            this.logger.warn(
                `${entity.name} is kept across a restore with ${keptWith.name}, which this data source holds no rows of. `
                + `A restore writes the rows of ${entity.name} as the backup holds them. Declare both in one data source.`
            );
        }
        this.backupResources.push(resource);
        if (isIncrementalBackupResource(resource) && resource.incrementalRead && retention?.fullRead == undefined) {
            this.logger.warn(
                `${getDiTokenName(provider.token)} reads only what changed, and reads in full once a week, since the backup `
                + 'retention names no fullRead. Set fullRead of ZIBRI_DI_TOKENS.BACKUP_RETENTION to say how often.'
            );
        }
        if (!MetadataUtilities.getBackupResourceMetadata(resource)?.transports.length) {
            throw new InitBackupServiceError('Needs to have at least one transport defined');
        }
        this.logger.info(`  - ${getDiTokenName(provider.token)}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppInit(): Promise<void> {
        // after every service is initialized rather than during: a transport reads through them, and
        // one in a bucket needs the http client's body parsers, which the parser only registers in its
        // own onAppInit - one that may well run after this service's
        // put back first, because what a half finished restore of the database left there is what the
        // sync would otherwise read
        await this.putBackInterruptedRestores();
        await this.syncBackupEntitiesFrom('skip');
        // not waited for: the transports of tenants are reached elsewhere, and a slow one would hold back the start
        this.tenantSyncAtStart = this.syncUnnamedTenantTransportsAtStart();
    }

    /**
     * Records the backups the transports of tenants hold that no recorded backup names, and warns when that fails.
     */
    private async syncUnnamedTenantTransportsAtStart(): Promise<void> {
        try {
            await this.syncUnnamedTenantTransports();
        }
        catch (error) {
            this.logger.warn(
                'Could not sync the transports of tenants no backup names: '
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    /**
     * Records the backups every transport of a tenant holds that no recorded backup names, on one instance
     * at a time: after the database was restored that is each of them, and otherwise the few no backup was
     * stored on yet. The others are synced as garbage is collected.
     */
    private async syncUnnamedTenantTransports(): Promise<void> {
        if (!this.tenantTransportsDeclared || !this.backupResources.length) {
            return;
        }
        await this.leaseService.withLease({ key: 'backup:tenant-sync', leaseInMs: Ms.MINUTE, mode: 'skip' }, async () => {
            const rows: TenantBackupTransport[] = await this.tenantTransportRepository.findAll({
                acrossTenants: true,
                limit: 'all'
            });
            if (!rows.length) {
                return;
            }
            const resourceRows: BackupResourceEntity[] = await this.backupResourceRepository.findAll({ limit: 'all' });
            const named: Set<string> = new Set(resourceRows.flatMap(r => r.transportNames));
            const unnamed: TenantBackupTransport[] = rows.filter(t => !named.has(this.toTenantTransport(t).name));
            for (const tenantId of new Set(unnamed.map(t => t.tenantId))) {
                // before the next tenant: a stop waits for this no longer than for stopping a backup
                if (this.tenantSyncStopping.signal.aborted) {
                    return;
                }
                await this.syncTenantBackupEntitiesFrom(
                    tenantId,
                    unnamed.filter(t => t.tenantId === tenantId).map(t => this.toTenantTransport(t)),
                    'skip'
                );
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        this.tenantSyncStopping.abort();
        try {
            await PromiseUtilities.withTimeout(
                async () => await this.tenantSyncAtStart,
                inject(ZIBRI_DI_TOKENS.BACKUP_STOPPING_TIMEOUT_IN_MS)
            );
        }
        catch (error) {
            // a transport of a tenant still answering is left to it: what it held is synced by the next start
            if (!(error instanceof TimeoutError)) {
                throw error;
            }
        }
        const finished: Promise<unknown> = Promise.all([
            firstValueFrom(this.isCreatingBackup.pipe(first(v => !v))),
            firstValueFrom(this.isRestoringBackup.pipe(first(v => !v)))
        ]);
        try {
            await PromiseUtilities.withTimeout(() => finished, this.shutdownWaitInMs);
        }
        catch (error) {
            if (!(error instanceof TimeoutError)) {
                throw error;
            }
            // stopped rather than waited for: the process is killed once the orchestrator's grace period
            // is over, and a backup or restore killed halfway leaves more to clean up than one stopped
            this.stopping.abort();
            await finished;
            // a resource this one was storing is handed back, and stored by whichever instance looks
            // first rather than at their next poll
            try {
                await this.wakeUpService.wake(this.backupRepository.dataSource, WAKE_UP_TOPICS.BACKUPS);
            }
            catch (error) {
                this.logger.warn(`Could not tell the other instances that backups were handed back: ${String(error)}`);
            }
        }
    }

    /**
     * Puts back what a restore applied before the process running it was killed.
     *
     * Its journal names what it started applying, and the snapshot beside each says what that held before.
     * Only this instance's disk holds them, so a replacement started on a fresh disk finds nothing to put back.
     */
    private async putBackInterruptedRestores(): Promise<void> {
        if (!this.backupResources.length) {
            return;
        }
        // one journal after another, and each one's resources in reverse: the order a restore applies
        // in is what putting back undoes
        for (const p of await RestoreJournalUtilities.findPaths(this.stagingFolder)) {
            let journal: RestoreJournal;
            try {
                journal = await RestoreJournalUtilities.resolve(p);
            }
            catch (error) {
                this.logger.error(new Error(`Could not read the journal ${p} of a restore that was interrupted.`, { cause: error }));
                continue;
            }
            const notPutBack: RestoreJournalEntry[] = await this.putBackAppliedResources(journal);
            // after the snapshots, which hold them as they were then: what replaced a data source holding the
            // encryption keys stored when the restore began is kept beside them. Writing them back twice changes nothing
            const { keptEncryptionKeys, keptUserRows, ...rest }: RestoreJournal = journal;
            const keysPending: boolean = await this.putBackKeptEncryptionKeys(journal.backupName, keptEncryptionKeys);
            // and so are the rows of the users that existed then, the same way
            const rowsPending: RestoreJournalEntry[] = await this.putBackKeptUserRows(journal.backupName, keptUserRows ?? []);
            if (notPutBack.length || keysPending || rowsPending.length) {
                await RestoreJournalUtilities.write(p, {
                    ...rest,
                    applied: notPutBack,
                    ...keysPending ? { keptEncryptionKeys } : {},
                    ...rowsPending.length ? { keptUserRows: rowsPending } : {}
                });
                continue;
            }
            // the other instances may hold what the restore had written
            await this.invalidateRestoredCaches(journal.tenantId, journal.backupName);
            await FsUtilities.rm(p);
            if (journal.applied.length) {
                this.logger.warn(
                    `The restore of backup "${journal.backupName}" was interrupted, and what it had applied was put back: `
                    + journal.applied.map(e => `"${e.resourceName}"`).join(', ')
                );
            }
        }
    }

    /**
     * Puts back each resource an interrupted restore had applied, the last one applied first.
     * @param journal - The journal of the interrupted restore.
     * @returns The entries of the resources that could not be put back, in the order they were applied.
     */
    private async putBackAppliedResources(journal: RestoreJournal): Promise<RestoreJournalEntry[]> {
        const notPutBack: RestoreJournalEntry[] = [];
        for (const entry of [...journal.applied].reverse()) {
            try {
                const resource: BackupResourceInterface | undefined = this.findBackupResource(entry.resourceName);
                if (!resource) {
                    throw new InternalError(`The application has no backup resource "${entry.resourceName}".`);
                }
                // a snapshot of one tenant's rows goes back as those rows, never as the whole data source
                await this.putBackFrom(
                    this.resolveScopedResource({ tenantId: journal.tenantId, name: journal.backupName }, resource),
                    await RestoreJournalUtilities.resolveSnapshot(entry, this.encryptionService),
                    entry.snapshotDigest
                );
                await FsUtilities.rm(entry.snapshotPath);
            }
            catch (error) {
                this.logger.error(new Error(
                    [
                        `Could not put back the resource "${entry.resourceName}", which the interrupted restore of backup`,
                        `"${journal.backupName}" had applied. What it held before is kept in ${entry.snapshotPath},`,
                        'and putting it back is tried again at the next start.'
                    ].join(' '),
                    { cause: error }
                ));
                notPutBack.unshift(entry);
            }
        }
        return notPutBack;
    }

    /**
     * Writes back the encryption keys an interrupted restore kept from before it began.
     * @param backupName - The name of the backup the interrupted restore restored.
     * @param keptEncryptionKeys - The keys the restore kept, if it kept any.
     * @returns Whether keys are left to write back at the next start.
     */
    private async putBackKeptEncryptionKeys(
        backupName: string,
        keptEncryptionKeys: KeptEncryptionKeys | undefined
    ): Promise<boolean> {
        if (keptEncryptionKeys == undefined) {
            return false;
        }
        try {
            await this.encryptionService.putBackKeptKeys?.(keptEncryptionKeys);
            return false;
        }
        catch (error) {
            this.logger.error(new Error(
                `Could not write back the encryption keys stored before the restore of backup "${backupName}". `
                + 'Writing them back is tried again at the next start.',
                { cause: error }
            ));
            return true;
        }
    }

    /**
     * Writes back the rows of the users an interrupted restore kept from before it began.
     * @param backupName - The name of the backup the interrupted restore restored.
     * @param keptUserRows - The entries of the rows the restore kept.
     * @returns The entries of the rows that could not be written back.
     */
    private async putBackKeptUserRows(backupName: string, keptUserRows: RestoreJournalEntry[]): Promise<RestoreJournalEntry[]> {
        const rowsPending: RestoreJournalEntry[] = [];
        for (const entry of keptUserRows) {
            try {
                const resource: BackupResourceInterface | undefined = this.findBackupResource(entry.resourceName);
                if (!resource) {
                    throw new InternalError(`The application has no backup resource "${entry.resourceName}".`);
                }
                await this.putBackUserRows({
                    resource,
                    file: await RestoreJournalUtilities.resolveSnapshot(entry, this.encryptionService)
                });
                await FsUtilities.rm(entry.snapshotPath);
            }
            catch (error) {
                this.logger.error(new Error(
                    `Could not write back the credentials of the users stored before the restore of backup "${backupName}" `
                    + `of "${entry.resourceName}", kept in ${entry.snapshotPath}. Writing them back is tried again at the next start.`,
                    { cause: error }
                ));
                rowsPending.push(entry);
            }
        }
        return rowsPending;
    }

    /**
     * Runs work on a stream that is destroyed when the application stops waiting for it.
     * @param stream - The stream to destroy.
     * @param work - What reads it.
     * @returns What the work returns.
     */
    private async stopOnShutdown<T>(stream: Readable, work: () => Promise<T>): Promise<T> {
        // the stream rather than whatever reads it, because the end that produces the data is the one
        // that can be waiting on something that is not coming
        const stop: () => void = () => stream.destroy(new Error('The application is shutting down.'));
        if (this.stopping.signal.aborted) {
            stop();
        }
        this.stopping.signal.addEventListener('abort', stop, { once: true });
        try {
            return await work();
        }
        finally {
            this.stopping.signal.removeEventListener('abort', stop);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncBackupEntities(): Promise<void> {
        await this.syncBackupEntitiesFrom('throw');
    }

    /**
     * Records every backup the transports hold that is not recorded yet.
     * @param unreachable - What a transport that cannot be read means: the sync fails, or the transport is
     * skipped with a warning.
     */
    private async syncBackupEntitiesFrom(unreachable: 'throw' | 'skip'): Promise<void> {
        if (!this.backupResources.length) {
            return;
        }
        const allTransports: BackupTransportInterface[] = this.resolveRegisteredTransports();
        if (!allTransports.length) {
            this.logger.warn('Could not find any transports to sync backup entities from');
            return;
        }
        // every one of them, and it means it: what this answers is which backups the transports hold
        // that are not recorded here, and a partial view of what is recorded would sync the rest a
        // second time
        const existingEntities: BackupEntity[] = await this.backupRepository.findAll({ limit: 'all' });
        const existingNames: string[] = existingEntities.map(e => e.name);
        const existingIds: string[] = existingEntities.map(e => e.id);
        const resolvedEntities: BackupEntity[] = (await Promise.all(allTransports.map(async t => {
            const documents: string[] = await this.resolveDocuments(t, existingNames, existingIds, unreachable);
            return documents.map(d => this.toBackupEntity(d, t)).filter(e => e != undefined);
        }))).flat();
        await this.recordSynced(resolvedEntities, existingIds);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncTenantBackupEntities(tenantId: string): Promise<void> {
        if (!UUIDUtilities.isUuid(tenantId)) {
            throw new BadRequestError($ts`The tenant of a backup needs to be a uuid.`);
        }
        this.validateTenantTransportsDeclared();
        await this.syncTenantBackupEntitiesFrom(tenantId, await this.resolveTenantTransports(tenantId), 'throw');
    }

    /**
     * Records every backup the transports of one tenant hold that is not recorded yet.
     *
     * Apart from the sync of the application's transports, which every instance runs as it starts: the
     * stores of tenants are many, reached elsewhere, and billed to their tenants per request.
     * @param tenantId - The tenant.
     * @param transports - The transports of the tenant to read.
     * @param unreachable - What a transport that cannot be read means: the sync fails, or the transport is
     * skipped with a warning.
     */
    private async syncTenantBackupEntitiesFrom(
        tenantId: string,
        transports: BackupTransportInterface[],
        unreachable: 'throw' | 'skip'
    ): Promise<void> {
        // every transport of the tenant, not only those read: a backup stored on two of them names both
        const transportNames: string[] = (await this.resolveTenantTransports(tenantId)).map(t => t.name);
        const existingIds: string[] = (await this.backupRepository.findAll({ limit: 'all' })).map(e => e.id);
        const resolved: BackupEntity[][] = await Promise.all(transports.map(async (t): Promise<BackupEntity[]> => {
            const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(t);
            if (store == undefined) {
                return [];
            }
            let documents: string[];
            try {
                // format 2 alone, which every backup of a tenant is written in: what else the tenant keeps in
                // its bucket is no backup of this application
                documents = await this.format2.resolveRecords(store, existingIds);
            }
            catch (error) {
                if (unreachable === 'throw') {
                    throw error;
                }
                this.logger.warn(
                    `Could not read the backups held by the transport "${t.name}" of the tenant ${tenantId}, so any it holds that are `
                    + `not recorded yet are left out until the next sync: ${error instanceof Error ? error.message : String(error)}`
                );
                return [];
            }
            return documents.flatMap(document => {
                const backup: BackupEntity | undefined = this.toBackupEntity(document, t);
                return backup != undefined && this.isRecordOfTenant(backup, tenantId, transportNames, t) ? [backup] : [];
            });
        }));
        await this.recordSynced(resolved.flat(), existingIds);
    }

    /**
     * Whether a record read off a transport of a tenant is one of that tenant's backups, stored on its
     * transports alone, warning about one that is not.
     *
     * The tenant owns the store, and with it every byte the record holds: a record naming another tenant,
     * or a transport that is not the tenant's, is one somebody put there.
     * @param backup - The backup the record describes.
     * @param tenantId - The tenant owning the transport.
     * @param transportNames - The names of the tenant's transports.
     * @param transport - Where the record came from, to name in a warning.
     * @returns Whether it is.
     */
    private isRecordOfTenant(
        backup: BackupEntity,
        tenantId: string,
        transportNames: string[],
        transport: BackupTransportInterface
    ): boolean {
        const isOfTenant: boolean = backup.tenantId === tenantId
            && backup.status === BackupStatus.COMPLETED
            && backup.formatVersion >= 2
            && backup.resources.length > 0
            && backup.resources.every(r => r.transportNames.length > 0 && r.transportNames.every(n => transportNames.includes(n)));
        if (!isOfTenant) {
            this.logger.warn(
                `The transport "${transport.name}" of the tenant ${tenantId} holds the record of a backup "${backup.id}" `
                + 'that is not a completed backup of that tenant on its own transports. Skipping it.'
            );
        }
        return isOfTenant;
    }

    /**
     * Records the backups a sync read off the transports that are not recorded yet, each once, with the
     * resources every transport holding it names.
     * @param resolved - The backups read, one per transport holding each.
     * @param existingIds - The ids of the backups recorded already.
     */
    private async recordSynced(resolved: BackupEntity[], existingIds: string[]): Promise<void> {
        const merged: BackupEntity[] = this.mergeEntities(this.groupEntitiesById(resolved.filter(e => !existingIds.includes(e.id))));
        await PromiseUtilities.allChunked(merged, e => this.backupRepository.create(e, { allowId: true }));
    }

    /**
     * Reads the records a transport holds.
     * @param transport - The transport to read.
     * @param existingNames - The names of the backups already recorded, which format 1 can skip.
     * @param existingIds - Their ids, which format 2 can skip.
     * @param unreachable - Whether a transport that cannot be read fails the sync or is skipped.
     * @returns The records, or none when the transport was skipped.
     */
    private async resolveDocuments(
        transport: BackupTransportInterface,
        existingNames: string[],
        existingIds: string[],
        unreachable: 'throw' | 'skip'
    ): Promise<string[]> {
        try {
            const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(transport);
            // both formats: a store holds the backups written before format 2 beside the ones after
            const [format1, format2] = await Promise.all([
                transport.resolveBackups(existingNames),
                store == undefined ? [] : this.format2.resolveRecords(store, existingIds)
            ]);
            return [...format1, ...format2];
        }
        catch (error) {
            switch (unreachable) {
                case 'throw': {
                    throw error;
                }
                case 'skip': {
                    // while the application starts: a backup server that is down or refusing this one must
                    // not keep the application from starting. Skipping one loses nothing that is recorded,
                    // since every transport of a backup holds the same record, and what only this one holds
                    // is recorded by the next sync that reaches it
                    this.logger.warn(
                        `Could not read the backups held by the transport "${transport.name}", so any it holds that are not `
                        + `recorded yet are left out until the next sync: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return [];
                }
            }
        }
    }

    /**
     * Reads a stored record back into the backup it describes.
     *
     * The format is checked before the record is read as one, because every field a backup is read by
     * is read in the shape that field names. A document in a shape this build does not know is
     * reported and left alone rather than interpreted as though it were this one - what it holds is
     * still there, and a build that knows the shape can still read it.
     * @param document - The record as the transport stored it.
     * @param transport - Where it came from, to name in a warning.
     * @returns The backup, or undefined when this build cannot read the document.
     */
    private toBackupEntity(document: string, transport: BackupTransportInterface): BackupEntity | undefined {
        let formatVersion: unknown;
        try {
            ({ formatVersion } = JsonUtilities.parse<VersionedBackupDocument>(document));
        }
        catch {
            this.logger.warn(`Transport "${transport.name}" holds a backup record that is not readable at all. Skipping it.`);
            return undefined;
        }

        if (typeof formatVersion !== 'number' || !READABLE_BACKUP_FORMAT_VERSIONS.includes(formatVersion)) {
            this.logger.warn(
                [
                    `Transport "${transport.name}" holds a backup written in backup format ${String(formatVersion)},`,
                    `and this build reads ${READABLE_BACKUP_FORMAT_VERSIONS.join(', ')}. Skipping it.`
                ].join('\n')
            );
            return undefined;
        }

        // through the entity rather than through json alone: a backup's timestamps are dates, and
        // json has no way to carry one - read without the shape they come back as the strings json
        // wrote them as
        const backup: BackupEntity = parseObject(document, BackupEntity) as BackupEntity;
        // what a restore and a delete find the backup on every transport by, so one reaching past the
        // folder the transport was given is never recorded, wherever it came from
        if (!this.isPathSegment(backup.name)) {
            this.logger.warn(`Transport "${transport.name}" holds a backup record whose name is not one segment of a path. Skipping it.`);
            return undefined;
        }
        return backup;
    }

    private mergeEntities(groupedEntities: Record<string, BackupEntity[]>): BackupEntity[] {
        const res: BackupEntity[] = [];
        for (const [, entities] of ObjectUtilities.entries(groupedEntities)) {
            const first: BackupEntity | undefined = entities[0];
            if (first == undefined) {
                continue;
            }
            res.push({
                createdAt: first.createdAt,
                id: first.id,
                name: first.name,
                // carried rather than left to the defaults, which would stamp every backup the
                // transports hold as written by whatever happens to be reading them
                zibriVersion: first.zibriVersion,
                formatVersion: first.formatVersion,
                status: first.status,
                tenantId: first.tenantId,
                masterKeys: first.masterKeys,
                dataKeyIds: first.dataKeyIds,
                resources: entities.reduce<BackupResourceEntity[]>(
                    (prev, curr) => [
                        ...prev,
                        ...curr.resources.filter(r => !prev.find(pr => pr.id === r.id))
                    ],
                    []
                )
            });
        }
        return res;
    }

    private groupEntitiesById(entities: BackupEntity[]): Record<string, BackupEntity[]> {
        const res: Record<string, BackupEntity[]> = {};
        for (const entity of entities) {
            const group: BackupEntity[] = res[entity.id] ?? [];
            group.push(entity);
            res[entity.id] = group;
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueBackup(data?: BackupCreateData): Promise<BackupEntity> {
        this.validateBackupName(data?.name);
        const tenantId: string | undefined = data?.tenantId ?? undefined;
        if (tenantId != undefined && !UUIDUtilities.isUuid(tenantId)) {
            throw new BadRequestError($ts`The tenant of a backup needs to be a uuid.`);
        }
        // of a tenant, the data sources holding rows of tenants, each read for the tenant alone
        const backed: BackupResourceInterface[] = tenantId == undefined
            ? this.backupResources
            : this.backupResources.filter(r => isDataSource(r) && TenantRowsBackupResource.holdsTenantRows(r));
        if (!backed.length) {
            throw new BadRequestError(
                $ts`No data source marked with @Backup holds rows of tenants, so there is nothing to back up of a tenant.`
            );
        }
        // of a tenant, its own transports alone: what the application's transports hold is the application's
        const tenantTransports: BackupTransportInterface[] = tenantId == undefined ? [] : await this.resolveTenantTransports(tenantId);
        if (tenantId != undefined && !tenantTransports.length) {
            throw new BadRequestError(
                $ts`The tenant ${tenantId} has no transport of its own to back up to. Add one with createTenantBackupTransport.`
            );
        }
        const resourceEntities: BackupResourceEntityCreateData[] = [];
        for (const backupResource of backed) {
            const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(backupResource);
            if (!metadata) {
                throw new BackupTransportNotFoundError(backupResource);
            }
            const transports: BackupTransportInterface[] = tenantId == undefined
                ? this.resolveTransportsFromMetadata(metadata)
                : tenantTransports;
            if (!transports.length) {
                throw new BackupTransportNotFoundError(backupResource);
            }
            resourceEntities.push({
                name: metadata?.name ?? backupResource.constructor.name,
                transportNames: transports.map(t => t.name)
            });
        }
        const backup: BackupEntity = await this.backupRepository.create({
            ...data,
            ...await this.resolveKeysNeeded(backed, tenantId == undefined),
            status: BackupStatus.RUNNING,
            resources: resourceEntities
        });

        // started here at once rather than at the next poll, and not awaited: the backup is queued
        // work, which any instance carries on with when this one stops
        // eslint-disable-next-line promise/prefer-await-to-then
        void this.runQueuedBackups().catch(
            // eslint-disable-next-line promise/prefer-await-to-callbacks
            error => this.logger.error(new InternalError(`Could not start storing the backup "${backup.name}"`, { cause: error }))
        );
        return backup;
    }

    /**
     * Refuses a backup name that is not one segment of a path.
     *
     * Every transport keeps a backup under its name: a folder, a remote folder or an object key. A
     * name reaching past that, such as `../`, stored the backup outside what the transport was given,
     * and deleting the backup removed it there.
     * @param name - The name the caller gave the backup, if any.
     * @throws BadRequestError when the name is empty, `.` or `..`, or holds a slash.
     */
    private validateBackupName(name: string | undefined): void {
        if (name != undefined && !this.isPathSegment(name)) {
            throw new BadRequestError(
                $ts`The name of a backup needs to be one segment of a path: not empty, "." or "..", and without a slash.`
            );
        }
        // where a transport keeps the chunks of every backup, which a backup of that name would be read as
        if (name === BACKUP_REPOSITORY_FOLDER) {
            throw new BadRequestError($ts`The name of a backup needs to be other than ${BACKUP_REPOSITORY_FOLDER}.`);
        }
    }

    /**
     * Whether a name is one segment of a path, which is what every transport keeps a backup under.
     * @param name - The name.
     * @returns True when it is not empty, `.` or `..`, and holds no slash and no NUL.
     */
    private isPathSegment(name: string): boolean {
        return name !== '' && name !== '.' && name !== '..' && !/[\0/\\]/.test(name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runQueuedBackups(): Promise<boolean> {
        if (!this.backupResources.length || this.stopping.signal.aborted) {
            return false;
        }
        // a trace of its own, for the reason a cron tick gets one: a backup is usually taken on a
        // schedule, and the one that is taken by hand is still not part of the request that asked
        // for it - it outlives the answer to that request
        this.runningPasses++;
        try {
            return await TracingUtilities.trace('runQueuedBackups', { root: true }, async () => {
                const ran: boolean = await QueueUtilities.poll(this.resolveQueue());
                // after the poll: the resource that completed a backup completes it, and this finds one
                // whose completing failed, so a backup never stays RUNNING with every resource stored
                await this.completeStoredBackups();
                return ran;
            });
        }
        finally {
            this.runningPasses--;
            if (!this.runningPasses && this.isCreatingBackup.value) {
                this.isCreatingBackup.next(false);
            }
        }
    }

    /**
     * Resolves the queue of the resources of the backups being taken.
     * @returns The queue.
     */
    private resolveQueue(): QueueDefinition<BackupResourceEntity> {
        return {
            name: 'backup',
            wakeUpTopic: WAKE_UP_TOPICS.BACKUPS,
            // how long the resources an instance that stopped existing was storing wait for another
            leaseInMs: Ms.MINUTE,
            onCompletion: 'release',
            claimedPer: 'item',
            maxConcurrentPerInstance: inject(ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES),
            firstRetryDelayInMs: inject(ZIBRI_DI_TOKENS.BACKUP_RETRY_DELAY_IN_MS),
            findDue: async () => await this.findDueResources(),
            findRunId: resource => resource.id,
            findMaxAttempts: () => inject(ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS),
            run: async resource => await this.storeResourceCounted(resource),
            record: async (resource, outcome) => await this.recordResourceAttempt(resource, outcome),
            resolveGiveUpError: (resource, cause) => new InternalError(
                `The resource "${resource.name}" of backup "${resource.backup.name}" was not stored, and is not tried again`,
                { cause }
            )
        };
    }

    /**
     * Finds the resources of the backups being taken that are due, and that this instance holds.
     * @returns The resources, with their backups.
     */
    private async findDueResources(): Promise<BackupResourceEntity[]> {
        const resources: BackupResourceEntity[] = await this.backupResourceRepository.findAll({
            where: [
                { completed: false, nextAttemptAt: null, backup: { where: { status: BackupStatus.RUNNING } } },
                { completed: false, nextAttemptAt: { before: new Date() }, backup: { where: { status: BackupStatus.RUNNING } } }
            ],
            relations: ['backup'],
            limit: 'all'
        });
        // one this instance has no resource for is left to an instance that has. So is one of a backup a newer
        // build queued in a format this one does not write: stored in an older format, a restore would read the
        // layout of the format the backup records, and find nothing there. The formats this build writes are the
        // ones it reads
        return resources.filter(r => this.findBackupResource(r.name) != undefined
            && READABLE_BACKUP_FORMAT_VERSIONS.includes(r.backup.formatVersion));
    }

    /**
     * Stores one resource, as a backup being created on this instance until its pass is over.
     * @param resource - The resource.
     * @throws A QueuedWorkHandedBackError when the application stopped it, so another instance stores it.
     */
    private async storeResourceCounted(resource: BackupResourceEntity): Promise<void> {
        if (!this.isCreatingBackup.value) {
            this.isCreatingBackup.next(true);
        }
        try {
            // the storing lease around the resource's: what a garbage collection waits for, held until the
            // resource counts as stored, so that it never deletes a chunk this found stored and names
            await this.leaseService.withLease(
                {
                    key: BackupService.resolveStoringLeaseKey(resource.name),
                    leaseInMs: Ms.MINUTE,
                    mode: 'wait',
                    acquireTimeoutInMs: RESOURCE_WAIT_IN_MS
                },
                async lost => {
                    // waited for, which is what another backup of the resource takes. A restore that outlasts the
                    // wait fails the attempt, which then waits out the retry delay: handed back instead, it would
                    // be run again at once, and the poll would go on running it for as long as the restore takes
                    const stored: StoredResourceRecord | undefined = await this.leaseService.withLease(
                        {
                            key: BackupService.resolveResourceLeaseKey(resource.name),
                            leaseInMs: Ms.MINUTE,
                            mode: 'wait',
                            acquireTimeoutInMs: RESOURCE_WAIT_IN_MS
                        },
                        async () => await this.storeResource(resource.backup, resource, lost)
                    );
                    if (stored == undefined) {
                        throw new InternalError(`Could not take the lease to store the resource "${resource.name}".`);
                    }
                    // a garbage collection holding the storing lease by now counts the manifest as unfinished,
                    // and may delete chunks it names
                    lost.throwIfAborted();
                    // only now, and only if every transport took the whole thing. What `completed` is for is
                    // telling a resource that finished from one that stopped halfway. Once the resource's lease
                    // is let go: counted as stored while it was held, the backup completed meanwhile, and a
                    // restore of it right after was refused as though the resource were still being backed up
                    await this.backupResourceRepository.updateById(resource.id, { ...stored, completed: true });
                }
            );
        }
        catch (error) {
            if (this.stopping.signal.aborted) {
                throw new QueuedWorkHandedBackError(`the application is shutting down, so another instance stores "${resource.name}"`);
            }
            throw error;
        }
    }

    /**
     * Records how an attempt at storing a resource ended. A resource that spent its attempts fails its
     * backup.
     * @param resource - The resource.
     * @param outcome - How the attempt ended.
     */
    private async recordResourceAttempt(resource: BackupResourceEntity, outcome: QueuedWorkOutcome): Promise<void> {
        await this.backupResourceRepository.updateById(
            resource.id,
            { attempts: outcome.attempts, nextAttemptAt: outcome.nextAttemptAt, error: outcome.error }
        );
        if (outcome.kind === 'failed') {
            await this.backupRepository.updateById(resource.backupId, { status: BackupStatus.FAILED });
            const failed: BackupEntity = await this.backupRepository.findById(resource.backupId, { relations: ['resources'] });
            this.tellWaiting(failed);
            await this.wakeUpService.wake(this.backupRepository.dataSource, WAKE_UP_TOPICS.backupEnded(resource.backupId));
            await this.removeStoredData(failed);
            return;
        }
        if (outcome.kind === 'succeeded') {
            try {
                await this.completeBackupIfStored(resource.backupId);
            }
            catch (error) {
                // the next poll completes it, see runQueuedBackups
                this.logger.error(new InternalError(`Could not complete the backup "${resource.backup.name}"`, { cause: error }));
            }
        }
    }

    /**
     * Completes every backup being taken whose resources are all stored.
     */
    private async completeStoredBackups(): Promise<void> {
        const running: BackupEntity[] = await this.backupRepository.findAll({
            where: { status: BackupStatus.RUNNING },
            relations: ['resources'],
            limit: 'all'
        });
        for (const backup of running.filter(b => b.resources.every(r => r.completed))) {
            await this.completeBackupIfStored(backup.id);
        }
    }

    /**
     * Completes a backup once every resource of it is stored: its record is written to the
     * transports, and the backup is `COMPLETED`.
     * @param id - The backup.
     */
    private async completeBackupIfStored(id: string): Promise<void> {
        // one at a time per backup, across instances, and read again under the lease: resources that
        // finished together each found it running with every resource stored, and each completed it,
        // storing the record and applying the retention once per resource
        await this.leaseService.withLease(
            { key: `backup:complete:${id}`, leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.MINUTE * 5 },
            async () => await this.completeBackupIfStoredWithin(id)
        );
    }

    /**
     * What {@link completeBackupIfStored} does under its lease.
     * @param id - The backup.
     */
    private async completeBackupIfStoredWithin(id: string): Promise<void> {
        const backup: BackupEntity = await this.backupRepository.findById(id, { relations: ['resources'] });
        // a resource stored after another one failed the backup: what it stored goes the way the rest did
        if (backup.status === BackupStatus.FAILED) {
            await this.removeStoredData(backup);
            return;
        }
        if (backup.status !== BackupStatus.RUNNING || !backup.resources.every(r => r.completed)) {
            return;
        }
        // the record first, the way a backup was always written: a backup whose record is missing
        // is one the transports never finished, and the status says COMPLETED only once they did
        const completed: BackupEntity = { ...backup, status: BackupStatus.COMPLETED };
        await this.storeMetadata(completed);
        await this.backupRepository.updateById(id, { status: BackupStatus.COMPLETED });
        await this.confirmReadCursors(completed);
        // before whoever waits for it is told, so that what they read of the instance includes it
        await this.warnWhenNotRestorable(completed);
        this.tellWaiting(completed);
        await this.wakeUpService.wake(this.backupRepository.dataSource, WAKE_UP_TOPICS.backupEnded(id));
        await this.applyRetention();
    }

    /**
     * Tells each resource of a completed backup that reads only what changed that the next backup reads on
     * from where this one read up to.
     * @param backup - The backup, completed, with its resources.
     */
    private async confirmReadCursors(backup: BackupEntity): Promise<void> {
        for (const r of backup.resources) {
            const resource: BackupResourceInterface | undefined = this.resolveBackupResource(r);
            if (r.readCursor == undefined || !isIncrementalBackupResource(resource)) {
                continue;
            }
            try {
                await resource.confirmReadCursor(r.readCursor);
            }
            catch (error) {
                // the backup is complete all the same: the next one reads on from this cursor, and a resource
                // that cannot continue from it reads in full
                this.logger.warn(
                    `Could not confirm where the next backup of "${r.name}" reads on from, after the backup "${backup.name}": `
                    + (error instanceof Error ? error.message : String(error))
                );
            }
        }
    }

    /**
     * Deletes every completed backup the retention keeps no longer, once a backup completed.
     *
     * After a backup completed rather than on a schedule of its own, the way `borgmatic` prunes after
     * it creates: a backup that is no longer kept is one a newer backup replaced, so nothing expires
     * while no backup completes.
     */
    private async applyRetention(): Promise<void> {
        const retention: BackupRetention | undefined = this.retention;
        if (retention == undefined && !this.tenantSettingsDeclared) {
            return;
        }
        try {
            // one instance at a time: two backups completing together would each delete what the other
            // already did, and a backup that completes meanwhile is counted by the next one
            await this.leaseService.withLease(
                { key: 'backup:retention', leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.MINUTE * 5 },
                async () => {
                    const completed: BackupEntity[] = await this.backupRepository.findAll({
                        where: { status: BackupStatus.COMPLETED },
                        relations: ['resources'],
                        limit: 'all'
                    });
                    // the backups of the application and those of each tenant are kept apart: a tenant's
                    // backup is no newer backup of the application, nor of another tenant
                    const byScope: Map<string | undefined, BackupEntity[]> = new Map();
                    for (const backup of completed) {
                        const scope: string | undefined = backup.tenantId ?? undefined;
                        byScope.set(scope, [...byScope.get(scope) ?? [], backup]);
                    }
                    // a tenant's own retention, where it set one, and the application's otherwise
                    const stored: Map<string, BackupRetention> = this.tenantSettingsDeclared
                        ? new Map((await inject(repositoryTokenFor(TenantBackupSettings)).findAll({ acrossTenants: true, limit: 'all' }))
                            .flatMap((s): [string, BackupRetention][] => s.retention == undefined ? [] : [[s.tenantId, s.retention]]))
                        : new Map<string, BackupRetention>();
                    for (const [scope, backups] of byScope) {
                        const kept: BackupRetention | undefined = (scope == undefined ? undefined : stored.get(scope)) ?? retention;
                        for (const backup of kept == undefined ? [] : BackupRetentionUtilities.findExpired(backups, kept, new Date())) {
                            await this.deleteExpired(backup);
                        }
                    }
                }
            );
        }
        catch (error) {
            this.logger.error(new InternalError(
                'Could not delete the backups the retention keeps no longer. The next backup to complete tries again.',
                { cause: error }
            ));
        }
    }

    /**
     * Deletes a backup the retention keeps no longer, and leaves it for the next time when that fails.
     * @param backup - The backup, with its resources.
     */
    private async deleteExpired(backup: BackupEntity): Promise<void> {
        try {
            await this.delete(backup);
            this.logger.info(`Deleted the backup "${backup.name}", which the retention keeps no longer.`);
        }
        catch (error) {
            // the others still go: one whose transport cannot be reached is no reason to keep the rest
            this.logger.warn(
                `Could not delete the backup "${backup.name}", which the retention keeps no longer.`
                + ' The next backup to complete tries again: '
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    /**
     * Removes what a failed backup stored, every resource of it from every transport meant to hold it,
     * and keeps its record, which says why it failed.
     *
     * Nothing restores a failed backup, so what it stored only takes up room. Removed from every
     * transport, including what the failing resource left halfway, since a transport may have taken
     * part of it. One that cannot be reached is warned about, and `delete` removes what it holds.
     * @param backup - The backup, with its resources.
     */
    private async removeStoredData(backup: BackupEntity): Promise<void> {
        const targets: [BackupResourceEntity, BackupTransportInterface[]][] = await Promise.all(
            backup.resources.map(async (resource): Promise<[BackupResourceEntity, BackupTransportInterface[]]> => [
                resource,
                await this.resolveScopedTransports(backup, resource)
            ])
        );
        await Promise.all(targets.flatMap(([resource, transports]) => transports.map(async transport => {
            try {
                await this.deleteResourceData(transport, backup, resource);
            }
            catch (error) {
                this.logger.warn(
                    `Could not remove what the failed backup "${backup.name}" stored of "${resource.name}"`
                    + ` on the transport "${transport.name}",`
                    + ` which deleting the backup removes: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        })));
    }

    /**
     * Hands a backup that ended here to whoever waits for it on this instance.
     * @param backup - The backup, as it ended.
     */
    private tellWaiting(backup: BackupEntity): void {
        for (const tell of this.waiting.get(backup.id) ?? []) {
            tell(backup);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async waitForBackup(backup: BackupEntity): Promise<BackupEntity> {
        let endedHere: BackupEntity | undefined;
        const listener: WakeUpListener = await this.wakeUpService.listen(
            this.backupRepository.dataSource,
            WAKE_UP_TOPICS.backupEnded(backup.id)
        );
        // told only once the listener exists, which it stops. An end in between is read below
        const tell: (ended: BackupEntity) => void = ended => {
            endedHere = ended;
            listener.stop();
        };
        const waitingFor: Set<(ended: BackupEntity) => void> = this.waiting.get(backup.id) ?? new Set();
        waitingFor.add(tell);
        this.waiting.set(backup.id, waitingFor);
        const startedAt: number = Date.now();
        let reportedAt: number = startedAt;
        try {
            for (;;) {
                // as it ended here when it did, and read otherwise, since another instance may have ended it
                const current: BackupEntity = endedHere ?? await this.backupRepository.findById(backup.id, { relations: ['resources'] });
                if (current.status === BackupStatus.COMPLETED) {
                    return current;
                }
                if (current.status === BackupStatus.FAILED) {
                    throw new BackupFailedError(current);
                }
                if (this.stopping.signal.aborted) {
                    throw new BackupStoppedError(current);
                }
                // a wait that lasts says where the backup stands: otherwise a backup that never ends is waited
                // for without a word, and nothing says which resource it is stuck on
                const reportIntervalInMs: number = inject(ZIBRI_DI_TOKENS.WAIT_REPORT_INTERVAL_IN_MS);
                if (Date.now() - reportedAt >= reportIntervalInMs) {
                    reportedAt = Date.now();
                    this.reportBackupWait(current, reportedAt - startedAt);
                }
                // read again every few seconds as well, for an end told through a data source that
                // carries no messages between instances, and by the next report at the latest
                await listener.next(Math.min(Ms.SECOND * 5, reportedAt + reportIntervalInMs - Date.now()), this.stopping.signal);
            }
        }
        finally {
            listener.stop();
            waitingFor.delete(tell);
            if (!waitingFor.size) {
                this.waiting.delete(backup.id);
            }
        }
    }

    /**
     * Warns that a backup is still waited for, saying where each of its resources stands.
     * @param backup - The backup, with its resources.
     * @param waitedInMs - How long it was waited for so far.
     */
    private reportBackupWait(backup: BackupEntity, waitedInMs: number): void {
        const resources: string = backup.resources
            .map(resource => {
                if (resource.completed) {
                    return `"${resource.name}" stored`;
                }
                const failed: string = `${resource.attempts} failed attempt${resource.attempts === 1 ? '' : 's'}`;
                const next: string = resource.nextAttemptAt == undefined ? '' : `, the next at ${resource.nextAttemptAt.toISOString()}`;
                const error: string = resource.error == undefined ? '' : `, the last with: ${resource.error.paragraphs.join(' ')}`;
                return `"${resource.name}" not stored, ${failed}${next}${error}`;
            })
            .join('; ');
        this.logger.warn(
            `Waited ${Math.round(waitedInMs / Ms.SECOND)} s for the backup "${backup.name}", which is ${backup.status}: ${resources || 'no resources'}`
        );
    }

    /**
     * Resolves the keys a backup taken now will need to be restored.
     *
     * Recorded when the backup is taken rather than worked out later, because which keys were in use
     * then is not something its data says once it is stored.
     * @param backed - The resources the backup holds.
     * @param whole - Whether it holds them whole, rather than the rows of a tenant.
     * @returns The master keys and the data keys it will need.
     */
    private async resolveKeysNeeded(
        backed: BackupResourceInterface[],
        whole: boolean
    ): Promise<Pick<BackupEntity, 'masterKeys' | 'dataKeyIds'>> {
        const keys: KeysInUse = await this.encryptionService.resolveKeysInUse();
        // a backup holding the key table brings its data keys back with it, encrypted under the master
        // keys of that time. One that does not needs the data keys to still exist, and needs a master
        // key only for its encrypted resources. A tenant's rows never hold the key table, which no tenant owns
        if (whole && backed.includes(keys.dataSource)) {
            return { masterKeys: keys.masterKeys, dataKeyIds: [] };
        }
        const encrypts: boolean = backed.some(r => MetadataUtilities.getBackupResourceMetadata(r)?.encrypt === true);
        return { masterKeys: encrypts ? [keys.currentMasterKey] : [], dataKeyIds: keys.dataKeyIds };
    }

    /**
     * Stores one resource of a backup on every transport meant to hold it.
     * @param backup - The backup the resource belongs to.
     * @param r - The resource as the backup records it.
     * @param lost - Aborts once the storing lease is lost, after which no manifest is written.
     * @returns What the resource records once it counts as stored.
     */
    private async storeResource(backup: BackupEntity, r: BackupResourceEntity, lost: AbortSignal): Promise<StoredResourceRecord> {
        const resource: BackupResourceInterface | undefined = this.resolveBackupResource(r);
        if (!resource) {
            throw new InternalError(`Could not find the backup resource "${r.name}" of backup "${backup.name}".`);
        }
        const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resource);
        if (!metadata) {
            throw new BackupTransportNotFoundError(resource);
        }
        // of a backup of a tenant, the transports it was queued with, the tenant's own among them
        const transports: BackupTransportInterface[] = backup.tenantId == undefined
            ? this.resolveTransportsFromMetadata(metadata)
            : await this.resolveScopedTransports(backup, r);
        if (!transports.length) {
            throw new BackupTransportNotFoundError(resource);
        }
        const stores: BackupTransportSupporting<'v2'>[] = transports.flatMap(t => this.findStore(t) ?? []);
        // the resource itself, or of a backup of a tenant the rows of that tenant it holds
        const read: BackupResourceInterface = this.resolveScopedResource(backup, resource);
        // chunked only where every transport stores chunks: a transport on BackupTransportInterface takes the
        // resource in one piece, and one checksum describes the resource on every transport it went to
        if (this.isFormat2(backup) && stores.length === transports.length) {
            return await this.storeChunked(backup, r, read, stores, metadata.encrypt, lost);
        }
        const key: Buffer | undefined = metadata.encrypt ? BackupEncryptionUtilities.generateKey() : undefined;
        // wrapped before the data is produced, so that a master key which cannot be used - a
        // kms that is down, say - fails the attempt before any of it is dumped or uploaded
        const encryptedKey: EncryptionString | undefined = key
            ? await this.encryptionService.masterEncrypt(key.toString('base64'))
            : undefined;
        const { data, record } = await this.resolveResourceData(backup, r, read, { chunked: false, stagingFolder: this.stagingFolder });
        // before staging, so that neither this instance's disk nor any transport ever holds
        // the data unencrypted
        const stored: Readable = key ? Readable.from(BackupEncryptionUtilities.encrypt(data, key)) : data;
        const digest: BackupDigest = await this.stopOnShutdown(
            data,
            async () => await this.storeAndMeasure(stored, transports, backup, r)
        );
        // staged as it came, encrypted and uncompressed rather than as a restore stages it, so its size says
        // nothing more than `size` does
        return { ...digest, ...record, encryptedKey, stagedSize: undefined };
    }

    /**
     * The resource a backup reads and restores: the registered one, or for a backup of a tenant the rows
     * that tenant holds in that data source.
     * @param backup - The backup.
     * @param resource - The resource as registered.
     * @returns The resource.
     * @throws When the backup is of a tenant and the resource is no data source.
     */
    private resolveScopedResource(
        backup: Pick<BackupEntity, 'tenantId' | 'name'>,
        resource: BackupResourceInterface
    ): BackupResourceInterface {
        if (backup.tenantId == undefined) {
            return resource;
        }
        if (!isDataSource(resource)) {
            throw new InternalError(`The backup "${backup.name}" is of a tenant, and holds a resource that is no data source.`);
        }
        return new TenantRowsBackupResource(resource, backup.tenantId);
    }

    /**
     * Reads a resource for a backup: of a resource that reads only what changed, what changed since the
     * backup it builds on, unless it reads in full this time.
     * @param backup - The backup being taken.
     * @param r - The resource as the backup records it.
     * @param resource - The resource.
     * @param options - What the backup does with the data.
     * @returns The data, and how it was read.
     */
    private async resolveResourceData(
        backup: BackupEntity,
        r: BackupResourceEntity,
        resource: BackupResourceInterface,
        options: BackupDataOptions
    ): Promise<ReadResourceData> {
        if (!isIncrementalBackupResource(resource) || !resource.incrementalRead) {
            return { data: await resource.createBackupData(backup, options), record: { baseBackupId: null, readCursor: null } };
        }
        const base: ChainLink | undefined = await this.findReadBase(backup, r);
        // recorded before it is read, so that the base is not deleted while this backup builds on it
        await this.backupResourceRepository.updateById(r.id, { baseBackupId: base?.backup.id ?? null });
        const read: IncrementalBackupData = await resource.createIncrementalBackupData(
            backup,
            options,
            base?.resource.readCursor ?? undefined
        );
        return {
            data: read.data,
            record: { baseBackupId: read.full ? null : base?.backup.id ?? null, readCursor: read.cursor }
        };
    }

    /**
     * Finds the backup the next backup of a resource that reads only what changed builds on: the newest
     * completed one that read it, unless the backup in full its chain starts at is of an earlier period
     * than `fullRead` of the retention, in which this backup reads in full.
     * @param backup - The backup being taken.
     * @param r - The resource as the backup records it.
     * @returns The base, or undefined when this backup reads in full.
     */
    private async findReadBase(backup: BackupEntity, r: BackupResourceEntity): Promise<ChainLink | undefined> {
        const completed: BackupEntity[] = await this.backupRepository.findAll({
            where: { status: BackupStatus.COMPLETED },
            relations: ['resources'],
            limit: 'all'
        });
        // of the same scope: a backup of a tenant holds the rows of that tenant alone, and reads nothing incrementally
        const newest: ChainLink | undefined = completed
            .filter(b => (b.tenantId ?? undefined) === (backup.tenantId ?? undefined))
            .flatMap(b => b.resources.filter(x => x.name === r.name && x.readCursor != undefined).map(x => ({ backup: b, resource: x })))
            .sort((a, b) => b.backup.createdAt.getTime() - a.backup.createdAt.getTime())[0];
        if (newest == undefined) {
            return undefined;
        }
        const chain: ChainLink[] | undefined = this.findChain(newest, completed);
        const full: ChainLink | undefined = chain?.[0];
        const retention: BackupRetention | undefined = this.retention;
        return full == undefined || !BackupRetentionUtilities.isSamePeriod(
            full.backup.createdAt,
            backup.createdAt,
            retention?.fullRead ?? DEFAULT_FULL_READ,
            retention?.timeZone ?? 'UTC'
        )
            ? undefined
            : newest;
    }

    /**
     * Finds the backups a backup of a resource builds on, back to the one in full.
     * @param link - The backup.
     * @param backups - The backups to look among, with their resources.
     * @returns The backups, the one in full first and the given one last, or undefined when one of them is
     * not among those looked in.
     */
    private findChain(link: ChainLink, backups: BackupEntity[]): ChainLink[] | undefined {
        const chain: ChainLink[] = [link];
        for (let current: ChainLink = link; current.resource.baseBackupId != undefined;) {
            const baseId: string = current.resource.baseBackupId;
            const base: BackupEntity | undefined = backups.find(b => b.id === baseId);
            const resource: BackupResourceEntity | undefined = base?.resources.find(x => x.name === link.resource.name);
            // a backup builds on an older one only, and a base the same backup twice would be no chain
            if (base == undefined || resource == undefined || chain.some(c => c.backup.id === base.id)) {
                return undefined;
            }
            current = { backup: base, resource };
            chain.unshift(current);
        }
        return chain;
    }

    /**
     * Stores one resource of a backup as chunks on every store meant to hold it.
     * @param backup - The backup the resource belongs to.
     * @param r - The resource as the backup records it.
     * @param resource - The resource.
     * @param stores - Where it is to be stored.
     * @param encrypt - Whether its chunks are encrypted.
     * @param lost - Aborts once the storing lease is lost, after which no manifest is written.
     * @returns What the resource records once it counts as stored.
     */
    private async storeChunked(
        backup: BackupEntity,
        r: BackupResourceEntity,
        resource: BackupResourceInterface,
        stores: BackupTransportSupporting<'v2'>[],
        encrypt: boolean,
        lost: AbortSignal
    ): Promise<StoredResourceRecord> {
        // before the data is produced, so that a master key which cannot be used fails the attempt before
        // any of it is dumped
        const repositoryKey: BackupRepositoryKey | undefined = encrypt
            ? await this.format2.resolveRepositoryKey(stores, backup.tenantId ?? undefined)
            : undefined;
        // recorded with the resource as a key of format 1 is, so that a restore finds out it lacks the master
        // key before it fetches anything, and one with the database gone reads it from the record
        const encryptedKey: EncryptionString | undefined = repositoryKey
            ? await this.encryptionService.masterEncrypt(this.format2.resolveKeyBytes(repositoryKey).toString('base64'))
            : undefined;
        // the staged copy is encrypted under a key that only this attempt holds in memory, so that this
        // instance's disk never holds the data unencrypted, and decrypted again as the chunks are cut
        const stagingKey: Buffer | undefined = encrypt ? BackupEncryptionUtilities.generateKey() : undefined;
        const stagingIv: Buffer = randomBytes(16);
        const { data, record } = await this.resolveResourceData(backup, r, resource, { chunked: true, stagingFolder: this.stagingFolder });
        // compressed before it is encrypted, after which nothing compresses. The chunks are cut from it
        // decompressed again: the same bytes, which is what decides where a chunk ends and what it holds
        const compressed: Readable = StagingUtilities.compress(data);
        const staged: Readable = stagingKey
            ? Readable.from(BackupEncryptionUtilities.encryptStaged(compressed, stagingKey, stagingIv))
            : compressed;
        const p: FsPath = this.stagingPathFor(backup, r);
        await FsUtilities.mkdir(this.stagingFolder);
        // so that a reader can stat it before the writer has opened it
        await FsUtilities.createFile(p, '');
        try {
            const digest: BackupDigest = await this.stopOnShutdown(data, async () => {
                // written without a digest: what the backup records is summed from its chunks
                const written: Promise<void> = pipeline(staged, FsUtilities.createWriteStream(p));
                const followed: AsyncIterable<Buffer> = StagingUtilities.followFile(p, written);
                const [, chunked] = await Promise.all([
                    written,
                    this.format2.storeChunks(
                        stores,
                        backup,
                        r,
                        StagingUtilities.decompress(
                            stagingKey ? BackupEncryptionUtilities.decryptStaged(followed, stagingKey, stagingIv) : followed
                        ),
                        repositoryKey,
                        lost
                    )
                ]);
                return chunked;
            });
            // staged the way a restore stages it, so that what restoring it takes is known before one is tried
            const stagedSize: number = (await FsUtilities.stat(p)).size;
            return { ...digest, ...record, encryptedKey, stagedSize };
        }
        finally {
            await FsUtilities.rm(p);
        }
    }

    /**
     * Whether a backup is written in format 2, in which every transport used as `v2` keeps it
     * under the folder of the repository.
     * @param backup - The backup.
     * @returns Whether it is.
     */
    private isFormat2(backup: BackupEntity): boolean {
        return backup.formatVersion >= 2;
    }

    /**
     * The transport of `v2` a transport keeps backups in, when it is used as one.
     * @param transport - The transport, as {@link resolveTransports} resolves it.
     * @returns The transport of `v2`, or undefined for a transport used as `v1`.
     */
    private findStore(transport: BackupTransportInterface): BackupTransportSupporting<'v2'> | undefined {
        return transport instanceof Format1BackupTransport ? transport.transport : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restore(backup: BackupEntity, options: RestoreOptions = {}): Promise<void> {
        // before anything else is believed about the record, because everything else a restore reads
        // out of it is read in the shape this names
        if (!READABLE_BACKUP_FORMAT_VERSIONS.includes(backup.formatVersion)) {
            throw new UnreadableBackupError(backup);
        }
        const selected: BackupEntity = this.resolveSelectedResources(backup, options);
        if (options.deleteFirst === true) {
            this.validateDeletesFirst(selected);
        }

        // every resource it applies, held across the deployment: a restore of it elsewhere, or a backup
        // reading it while it is replaced, would be judged by a flag only this process can see
        const keys: string[] = selected.resources.map(r => BackupService.resolveResourceLeaseKey(r.name));
        const restored: boolean | undefined = await this.leaseService.withLeases(keys, { leaseInMs: Ms.MINUTE }, async taken => {
            if (taken.length < keys.length) {
                throw this.resolveResourcesBusyError(
                    selected.resources.filter(r => !taken.includes(BackupService.resolveResourceLeaseKey(r.name)))
                );
            }
            await TracingUtilities.trace('restore', { root: true }, async () => await this.restoreWithAudit(selected, options));
            return true;
        });
        if (restored == undefined) {
            throw this.resolveResourcesBusyError(selected.resources);
        }
    }

    /**
     * The backup with the resources a restore of it applies: those the options name, or every one.
     * @param backup - The backup.
     * @param options - How it is restored.
     * @returns The backup, holding those resources alone.
     * @throws {BadRequestError} When the options name a resource the backup does not hold.
     */
    private resolveSelectedResources(backup: BackupEntity, options: RestoreOptions): BackupEntity {
        if (options.resources == undefined) {
            return backup;
        }
        const names: string[] = options.resources;
        const unknown: string[] = names.filter(name => !backup.resources.some(r => r.name === name));
        if (unknown.length || !names.length) {
            const held: string = backup.resources.map(r => r.name).join(', ');
            const notHeld: string = unknown.join(', ') || 'none of them';
            throw new BadRequestError($ts`The backup "${backup.name}" holds the resources ${held}, and not ${notHeld}.`);
        }
        return { ...backup, resources: backup.resources.filter(r => names.includes(r.name)) };
    }

    /**
     * Refuses a restore deleting what the resources hold first when one of them cannot.
     * @param backup - The backup, holding the resources restored.
     * @throws {BadRequestError} Naming the resources that cannot.
     */
    private validateDeletesFirst(backup: BackupEntity): void {
        // what a data source deletes is all of it, which a restore of one tenant's rows never touches
        if (backup.tenantId != undefined) {
            throw new BadRequestError($ts`A restore of a tenant replaces the tenant's rows alone, and deletes nothing first.`);
        }
        const unable: string[] = backup.resources
            .filter(r => this.resolveBackupResource(r)?.deleteBackedUpData == undefined)
            .map(r => r.name);
        if (unable.length) {
            throw new BadRequestError($ts`The resources ${unable.join(', ')} cannot delete what they hold before a restore.`);
        }
    }

    /**
     * Resolves what restoring a backup takes on this instance's disk before anything is fetched: of each
     * resource, what each backup a restore of it applies took as staged, and a copy of about that much of what
     * it holds now, which a failed restore puts back from.
     * @param backup - The backup, holding the resources restored.
     * @param options - How it is restored.
     * @returns What it takes, and what the disk has free.
     */
    private async resolveRestoreSpace(backup: BackupEntity, options: RestoreOptions): Promise<RestoreSpace> {
        const known: BackupResourceEntity[] = backup.resources.filter(r => this.resolveBackupResource(r) != undefined);
        const resources: RestoreSpaceOfResource[] = [];
        for (const resource of known) {
            const chain: ChainLink[] = await this.resolveRestoredChain(backup, resource);
            const fetchedBytes: number = chain.reduce(
                (sum, link) => sum + (link.resource.stagedSize ?? link.resource.size ?? 0),
                0
            );
            // alone, a resource whose restore changes everything or nothing by itself keeps no copy. Only its data
            // says whether it does, which is asked once it is fetched, before a copy is taken
            const restoresAlone: boolean = known.length === 1
                && this.resolveBackupResource(resource)?.resolveRestoresWhole != undefined;
            resources.push({
                name: resource.name,
                fetchedBytes,
                snapshotBytes: options.putBack === false || restoresAlone ? 0 : fetchedBytes,
                atMost: chain.some(link => link.resource.stagedSize == undefined)
            });
        }
        return {
            backupName: backup.name,
            folder: this.stagingFolder,
            freeBytes: await FsUtilities.resolveFreeBytes(this.stagingFolder),
            resources
        };
    }

    /**
     * Resolves what the copies of what the resources hold take, once their backups are fetched: about what
     * fetching each took, which the disk holds already.
     * @param backup - The backup.
     * @param staged - Its resources, fetched.
     * @returns What the restore takes, and what the disk has for it: what is free and what fetching took.
     */
    private async resolveSnapshotSpace(backup: BackupEntity, staged: StagedResource[]): Promise<RestoreSpace> {
        const resources: RestoreSpaceOfResource[] = await Promise.all(staged.map(async (s): Promise<RestoreSpaceOfResource> => {
            const sizes: number[] = await Promise.all(
                [s.data, ...s.increments].map(async f => (await FsUtilities.stat(f.path)).size)
            );
            const fetchedBytes: number = sizes.reduce((sum, size) => sum + size, 0);
            return { name: s.entity.name, fetchedBytes, snapshotBytes: fetchedBytes, atMost: false };
        }));
        const freeBytes: number = await FsUtilities.resolveFreeBytes(this.stagingFolder);
        return {
            backupName: backup.name,
            folder: this.stagingFolder,
            freeBytes: freeBytes + resources.reduce((sum, r) => sum + r.fetchedBytes, 0),
            resources
        };
    }

    /**
     * Tells, critically, when this instance's disk is too small to restore a backup just completed, which is
     * when there is time to add room rather than when a restore is needed.
     * @param backup - The backup, completed, with its resources.
     */
    private async warnWhenNotRestorable(backup: BackupEntity): Promise<void> {
        try {
            const space: RestoreSpace = await this.resolveRestoreSpace(backup, {});
            if (NotEnoughRestoreSpaceError.resolveNeededBytes(space.resources) > space.freeBytes) {
                this.logger.critical(new InternalError(
                    `This instance cannot restore backup "${backup.name}" with the room its disk has now. `
                    + 'Add room before a restore is needed.',
                    { cause: new NotEnoughRestoreSpaceError(space, 'foreseen') }
                ));
            }
        }
        catch (error) {
            // the backup is stored either way, and this is what it is about
            this.logger.warn(
                `Could not tell whether this instance can restore backup "${backup.name}": `
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    /**
     * Whether an error is a disk that ran out of space, itself or as what caused it.
     * @param error - The error.
     * @returns Whether it is.
     */
    private static isOutOfSpace(error: unknown): boolean {
        for (let current: unknown = error; current instanceof Error; current = current.cause) {
            if ('code' in current && current.code === 'ENOSPC') {
                return true;
            }
        }
        return false;
    }

    /**
     * Restores a backup, and of a tenant records in its audit trail that its rows were replaced, or that
     * replacing them failed.
     * @param backup - The backup.
     * @param options - How it is restored.
     */
    private async restoreWithAudit(backup: BackupEntity, options: RestoreOptions): Promise<void> {
        const tenantId: string | null | undefined = backup.tenantId;
        if (tenantId == undefined) {
            await this.restoreWithin(backup, options);
            return;
        }
        const audit: () => AuditServiceInterface = () => inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
            try {
                await this.restoreWithin(backup, options);
                audit().record({ action: AuditAction.TENANT_RESTORED, outcome: AuditOutcome.SUCCESS, subject: backup.name });
            }
            catch (error) {
                audit().record({
                    action: AuditAction.TENANT_RESTORED,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditUtilities.resolveReason(error),
                    subject: backup.name
                });
                throw error;
            }
        });
    }

    /**
     * The refusal of a restore whose resources are being backed up or restored elsewhere.
     * @param busy - The resources.
     * @returns The error.
     */
    private resolveResourcesBusyError(busy: BackupResourceEntity[]): ConflictError {
        const names: string = busy.map(r => r.name).join(', ');
        return new ConflictError($ts`The backup resources ${names} are being backed up or restored. Restore once that is done.`);
    }

    /**
     * The key of the lease a backup or a restore of a resource holds while it reads or replaces it.
     * @param name - The name of the resource.
     * @returns The key.
     */
    private static resolveResourceLeaseKey(name: string): string {
        return `backup:resource:${name}`;
    }

    /**
     * The key of the lease a backup of a resource holds from before it stores the resource until the resource
     * counts as stored, which a garbage collection takes to delete chunks. A key apart from the resource's,
     * so that a restore goes on while garbage is collected.
     * @param name - The name of the resource.
     * @returns The key.
     */
    private static resolveStoringLeaseKey(name: string): string {
        return `backup:storing:${name}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async collectGarbage(): Promise<void> {
        // the tenants' own as well, one after another like the application's
        const tenantRows: TenantBackupTransport[] = this.tenantTransportsDeclared && this.backupResources.length
            ? await this.tenantTransportRepository.findAll({ acrossTenants: true, limit: 'all' })
            : [];
        const tenantTransports: BackupTransportInterface[] = tenantRows.map(t => this.toTenantTransport(t));
        const transports: BackupTransportInterface[] = [...this.resolveRegisteredTransports(), ...tenantTransports];
        const stores: BackupTransportSupporting<'v2'>[] = [...new Set(transports.flatMap(t => this.findStore(t) ?? []))];
        if (!this.backupResources.length || !stores.length) {
            return;
        }
        const failures: unknown[] = [];
        // one at a time across instances: two would each delete what the other's second look at the
        // manifests cannot see
        await this.leaseService.withLease({ key: 'backup:garbage-collection', leaseInMs: Ms.MINUTE, mode: 'skip' }, async () => {
            try {
                // so that every backup a transport records is in the database, which tells its chunks from garbage
                await this.syncBackupEntities();
            }
            catch (error) {
                this.logger.warn(
                    'Could not sync the backups before collecting their garbage: '
                    + (error instanceof Error ? error.message : String(error))
                );
            }
            // the tenants' as well, which nothing else syncs: after the database was restored, their backups are
            // recorded nowhere, and a store holding a record the database lacks keeps its garbage
            for (const tenantId of new Set(tenantRows.map(t => t.tenantId))) {
                try {
                    await this.syncTenantBackupEntitiesFrom(
                        tenantId,
                        tenantRows.filter(t => t.tenantId === tenantId).map(t => this.toTenantTransport(t)),
                        'skip'
                    );
                }
                catch (error) {
                    this.logger.warn(
                        `Could not sync the backups of the tenant ${tenantId} before collecting their garbage: `
                        + (error instanceof Error ? error.message : String(error))
                    );
                }
            }
            const scrub: BackupScrubOptions | undefined = inject(ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS);
            for (const store of stores) {
                try {
                    await this.garbageCollector.collect(store, async work => await this.withGarbageCollectionWindow(work), scrub);
                }
                catch (error) {
                    failures.push(new InternalError(
                        `Could not collect the garbage of the backup transport "${store.name}".`,
                        { cause: error }
                    ));
                }
            }
        });
        if (failures.length) {
            throw failures.length === 1
                ? failures[0]
                : new AggregateError(failures, 'Could not collect the garbage of several backup transports.');
        }
    }

    /**
     * Runs work while no resource of the application is being stored as chunks, waiting for a pause.
     * @param work - The work.
     * @returns What the work returns.
     * @throws When resources were stored without a pause for as long as a collection waits.
     */
    private async withGarbageCollectionWindow<T>(work: (lost: AbortSignal) => Promise<T>): Promise<T> {
        const giveUpAt: number = Date.now() + GARBAGE_COLLECTION_WAIT_IN_MS;
        // a pause between two windows longer than a resource waiting for its lease takes to try again, so
        // that one waiting gets in: taken back to back, the windows of a long sweep kept every backup out
        // until its attempts ran out
        const sinceLastWindow: number = Date.now() - this.garbageCollectionWindowEndedAt;
        if (sinceLastWindow < GARBAGE_COLLECTION_PAUSE_IN_MS) {
            await setTimeout(GARBAGE_COLLECTION_PAUSE_IN_MS - sinceLastWindow, undefined, { signal: this.stopping.signal });
        }
        for (;;) {
            const names: string[] = await this.resolveStorableResourceNames();
            const keys: string[] = names.map(name => BackupService.resolveStoringLeaseKey(name));
            const outcome: GarbageCollectionWindowOutcome<T> | undefined = await this.leaseService.withLeases(
                keys,
                { leaseInMs: Ms.MINUTE },
                async (taken, lost): Promise<GarbageCollectionWindowOutcome<T>> => {
                    // all or nothing, and read again once they are held: a backup queued meanwhile may hold a
                    // resource this instance does not know, such as one a newer release added
                    if (taken.length < keys.length
                        || (await this.resolveStorableResourceNames()).some(name => !names.includes(name))) {
                        return { taken: false };
                    }
                    try {
                        return { taken: true, value: await work(lost) };
                    }
                    finally {
                        this.garbageCollectionWindowEndedAt = Date.now();
                    }
                }
            );
            if (outcome?.taken === true) {
                return outcome.value;
            }
            if (Date.now() >= giveUpAt) {
                throw new InternalError('Resources were being stored for an hour without a pause, in which garbage is collected.');
            }
            await setTimeout(GARBAGE_COLLECTION_RETRY_IN_MS, undefined, { signal: this.stopping.signal });
        }
    }

    /**
     * The names of the resources a backup may be storing: those of this application, and those of a
     * backup being taken that another release of it may store.
     * @returns The names.
     */
    private async resolveStorableResourceNames(): Promise<string[]> {
        const running: BackupResourceEntity[] = await this.backupResourceRepository.findAll({
            where: { completed: false, backup: { where: { status: BackupStatus.RUNNING } } },
            limit: 'all'
        });
        const registered: string[] = this.backupResources.flatMap(
            r => MetadataUtilities.getBackupResourceMetadata(r)?.name ?? []
        );
        return [...new Set([...registered, ...running.map(r => r.name)])];
    }

    /**
     * Everything restoring a backup does, once the record has been found readable.
     * @param backup - The backup to restore.
     * @param options - How it is restored.
     */
    private async restoreWithin(backup: BackupEntity, options: RestoreOptions): Promise<void> {
        // a restore over what one before could not put back would take its snapshot of the half restored
        // state, and a restore of the same backup would write over the snapshot and journal kept for the next start
        const waiting: FsPath[] = await RestoreJournalUtilities.findPaths(this.stagingFolder);
        if (waiting.length) {
            const journals: string = waiting.join(', ');
            throw new ConflictError(
                // one template, since it is the key of its translation
                // eslint-disable-next-line stylistic/max-len
                $ts`A restore before this one left resources that the next start puts back, named in ${journals}. Restart the application first.`
            );
        }
        // before anything is fetched: a disk too small for it is told in a second, rather than once hours of
        // fetching ran into it
        const space: RestoreSpace = await this.resolveRestoreSpace(backup, options);
        BackupService.validateRestoreSpace(space, options);
        this.isRestoringBackup.next(true);
        const staged: StagedResource[] = [];
        let keptSnapshotPaths: FsPath[] = [];
        let keys: KeysAcrossRestore | undefined;
        let userRows: UserRowsAcrossRestore[] = [];
        const journalPath: FsPath = RestoreJournalUtilities.getPath(this.stagingFolder, backup.id);
        try {
            await FsUtilities.mkdir(this.stagingFolder);
            // every archive is fetched and checked before any of them is applied: a resource applied
            // while another one's archive can still turn out unusable is a restore that half happened.
            // Settled rather than raced, so that nothing is still writing to the staging folder once
            // this cleans it up
            const settled: PromiseSettledResult<StagedResource | undefined>[] = await Promise.allSettled(
                backup.resources.map(async resource => await this.stageResource(resource, backup))
            );
            staged.push(...settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []));
            // nothing is applied yet, so a stop here has nothing to put back
            if (this.stopping.signal.aborted) {
                throw new RestoreStoppedError(backup);
            }
            const failure: PromiseRejectedResult | undefined = settled.find(r => r.status === 'rejected');
            if (failure) {
                // nothing is applied yet: running out of space here is told with what it needs, and what to do
                throw BackupService.isOutOfSpace(failure.reason) ? new NotEnoughRestoreSpaceError(space, 'ranOut') : failure.reason;
            }
            // a resource restored alone whose restore changes everything or nothing by itself has nothing to
            // be put back, and the copy would take as much disk again as its data
            // before anything is applied: what every instance running encrypts with is what is stored now
            keys = await this.resolveKeysAcrossRestore(backup, staged);
            // and the credentials of every user that exists now, so that none revoked since the backup works again
            userRows = await this.stageUserRowsAcrossRestore(backup, staged);
            const [only] = staged;
            if (options.putBack === false || (staged.length === 1 && only != undefined && await this.resolveRestoresWhole(only))) {
                await this.applyStaged(
                    staged.map(s => ({ ...s, snapshotDigest: undefined })),
                    backup,
                    journalPath,
                    keys,
                    userRows,
                    options
                );
                return;
            }
            // and again now that what fetching took is known, which is what each copy takes about as well
            const snapshotSpace: RestoreSpace = await this.resolveSnapshotSpace(backup, staged);
            BackupService.validateRestoreSpace(snapshotSpace, options);
            // what every resource holds right now, taken before any of them changes, so that one failing
            // to apply can be undone by putting the others back
            const snapshotted: SnapshottedResource[] = await Promise.all(staged.map(async (s): Promise<SnapshottedResource> => {
                // kept on this instance's disk in one piece, until the restore is done
                const current: Readable = await s.resource.createBackupData(
                    backup,
                    { chunked: false, stagingFolder: this.stagingFolder }
                );
                const snapshotDigest: BackupDigest = await this.stopOnShutdown(
                    current,
                    async () => await StagingUtilities.stage(current, s.snapshot)
                );
                // on the disk before the journal names it: a machine going down while the resource is
                // applied leaves it to be put back from this file at the next start
                await FsUtilities.sync(s.snapshot.path);
                return { ...s, snapshotDigest };
            })).catch((error: unknown) => {
                if (this.stopping.signal.aborted) {
                    throw new RestoreStoppedError(backup);
                }
                throw BackupService.isOutOfSpace(error) ? new NotEnoughRestoreSpaceError(snapshotSpace, 'ranOut') : error;
            });
            await this.applyStaged(snapshotted, backup, journalPath, keys, userRows, options);
        }
        catch (error) {
            if (error instanceof RestoreNotUndoneError) {
                keptSnapshotPaths = error.snapshotPaths;
            }
            if (keptSnapshotPaths.length || keys?.pending === true || userRows.some(r => r.pending)) {
                await this.keepForNextStart(journalPath, keptSnapshotPaths, keys, userRows);
            }
            throw error;
        }
        finally {
            // a journal outlives the restore only when the process was killed, or when it names what the
            // restore could not put back, which the next start puts back as it would after a kill
            await Promise.all([
                ...keptSnapshotPaths.length || keys?.pending === true || userRows.some(r => r.pending)
                    ? []
                    : [FsUtilities.rm(journalPath)],
                ...staged.flatMap(s => [
                    FsUtilities.rm(s.data.path),
                    ...s.increments.map(i => FsUtilities.rm(i.path)),
                    ...keptSnapshotPaths.includes(s.snapshot.path) ? [] : [FsUtilities.rm(s.snapshot.path)]
                ]),
                ...userRows.filter(r => !r.pending).map(r => FsUtilities.rm(r.file.path))
            ]);
            this.isRestoringBackup.next(false);
        }
    }

    /**
     * Refuses a restore that takes more room than this instance's disk has, unless the options skip the check.
     * @param space - What the restore takes, and what the disk has free.
     * @param options - How it is restored.
     * @throws {NotEnoughRestoreSpaceError} When the disk has too little room.
     */
    private static validateRestoreSpace(space: RestoreSpace, options: RestoreOptions): void {
        if (options.skipSpaceCheck !== true && NotEnoughRestoreSpaceError.resolveNeededBytes(space.resources) > space.freeBytes) {
            throw new NotEnoughRestoreSpaceError(space, 'refused');
        }
    }

    /**
     * Leaves in the journal of a restore what the next start puts back: the resources it could not put
     * back, and the encryption keys and rows of the users it may not have written back.
     * @param journalPath - The journal.
     * @param snapshotPaths - The snapshots of those resources.
     * @param keys - The keys the restore keeps, if any.
     * @param userRows - The rows of the users the restore keeps.
     */
    private async keepForNextStart(
        journalPath: FsPath,
        snapshotPaths: FsPath[],
        keys: KeysAcrossRestore | undefined,
        userRows: UserRowsAcrossRestore[]
    ): Promise<void> {
        try {
            const { keptEncryptionKeys, ...journal }: RestoreJournal = await RestoreJournalUtilities.resolve(journalPath);
            const pendingRows: RestoreJournalEntry[] = userRows.filter(r => r.pending).map(r => r.entry);
            await RestoreJournalUtilities.write(journalPath, {
                ...journal,
                applied: journal.applied.filter(e => snapshotPaths.includes(e.snapshotPath)),
                ...keys?.pending === true && keptEncryptionKeys != undefined ? { keptEncryptionKeys } : {},
                keptUserRows: pendingRows.length ? pendingRows : undefined
            });
        }
        catch (error) {
            // the restore's own error is what the caller needs to hear. The snapshots stay in place
            this.logger.error(new Error(
                `Could not keep the journal ${journalPath} for the next start to put back what it names.`,
                { cause: error }
            ));
        }
    }

    /**
     * Applies every staged resource, one after another, and puts back what was applied when one fails
     * or the application stops waiting for the restore.
     *
     * One after another rather than together, so that a resource failing stops the restore before
     * anything after it is touched.
     * @param staged - The resources, each with its data and a snapshot of what it holds now.
     * @param backup - The backup being restored.
     * @param journalPath - Where the restore notes what it started applying.
     * @param keys - The encryption keys the restore keeps, when it replaces a data source holding them.
     * @param userRows - The rows of the users the restore keeps, of each data source it replaces holding them.
     * @param options - How it is restored.
     * @throws What the failing resource threw, once the others are put back.
     * @throws {RestoreStoppedError} When the application stopped waiting, once the applied resources are put back.
     * @throws {RestoreNotUndoneError} When a resource could not be put back either.
     */
    private async applyStaged(
        staged: SnapshottedResource[],
        backup: BackupEntity,
        journalPath: FsPath,
        keys: KeysAcrossRestore | undefined,
        userRows: UserRowsAcrossRestore[],
        options: RestoreOptions
    ): Promise<void> {
        const applied: SnapshottedResource[] = [];
        const journal: RestoreJournal = {
            backupName: backup.name,
            ...backup.tenantId == undefined ? {} : { tenantId: backup.tenantId },
            applied: [],
            ...keys == undefined ? {} : { keptEncryptionKeys: keys.kept },
            ...userRows.length ? { keptUserRows: userRows.map(r => r.entry) } : {}
        };
        try {
            for (const s of staged) {
                // between two resources, the one place a restore can stop without leaving one of them half applied
                if (this.stopping.signal.aborted) {
                    await this.putBack(applied, backup, new RestoreStoppedError(backup), keys, userRows, options);
                }
                const replacesKeys: boolean = keys != undefined && this.holdsEncryptionKeys(s.resource);
                const replacedRows: UserRowsAcrossRestore | undefined = userRows.find(r => r.resource === s.resource);
                await this.noteApplying(s, journal, journalPath, replacesKeys, replacedRows);
                try {
                    await this.applyStagedWithKept(s, replacesKeys ? keys : undefined, replacedRows, options);
                    applied.push(s);
                }
                catch (error) {
                    // what went in of a resource without a snapshot stays in place, the keys and rows of the users
                    // it replaced among it
                    if (s.snapshotDigest == undefined) {
                        await this.tryPutBackKept(keys, replacedRows);
                    }
                    // the failing one is put back too: nothing promises that a resource which throws has
                    // applied none of its data, and putting back one that did is the same state again
                    await this.putBack([...applied, s], backup, error, keys, userRows, options);
                }
            }
        }
        finally {
            // however it ended: a resource applied in place answered reads with part of the backup, which a
            // cache may hold after it is put back
            await this.invalidateRestoredCaches(backup.tenantId ?? undefined, backup.name);
        }
    }

    /**
     * Notes in the journal of a restore that a resource is about to be applied, when there is something
     * the next start would put back of it.
     * @param s - The resource about to be applied.
     * @param journal - The journal, which this adds the resource to.
     * @param journalPath - Where the journal is kept.
     * @param replacesKeys - Whether the resource replaces the encryption keys the restore keeps.
     * @param replacedRows - The rows of the users the restore keeps of the resource, if any.
     */
    private async noteApplying(
        s: SnapshottedResource,
        journal: RestoreJournal,
        journalPath: FsPath,
        replacesKeys: boolean,
        replacedRows: UserRowsAcrossRestore | undefined
    ): Promise<void> {
        // noted before it is applied, so a process killed while applying it leaves it to be put back
        // at the next start. One without a snapshot is all or nothing by itself, and a kill leaves
        // nothing of it to put back, but the keys and rows of the users it replaces, which the journal holds
        if (s.snapshotDigest != undefined) {
            journal.applied.push(
                await RestoreJournalUtilities.resolveEntry(s.entity.name, s.snapshot, s.snapshotDigest, this.encryptionService)
            );
        }
        if (s.snapshotDigest != undefined || replacesKeys || replacedRows != undefined) {
            await RestoreJournalUtilities.write(journalPath, journal);
        }
    }

    /**
     * Applies one staged resource, and writes back the encryption keys and the rows of the users the restore
     * keeps of it once it is applied.
     * @param s - The resource.
     * @param replacedKeys - The encryption keys the restore keeps, when the resource replaces them.
     * @param replacedRows - The rows of the users the restore keeps of the resource, if any.
     * @param options - How it is restored.
     */
    private async applyStagedWithKept(
        s: SnapshottedResource,
        replacedKeys: KeysAcrossRestore | undefined,
        replacedRows: UserRowsAcrossRestore | undefined,
        options: RestoreOptions
    ): Promise<void> {
        if (replacedKeys != undefined) {
            replacedKeys.pending = true;
        }
        if (replacedRows != undefined) {
            replacedRows.pending = true;
        }
        // so that the server holds the backup alone rather than both until the restore is done
        if (options.deleteFirst === true) {
            await s.resource.deleteBackedUpData?.();
        }
        await this.applyStagedResource(s);
        if (replacedKeys != undefined) {
            await this.encryptionService.putBackKeptKeys?.(replacedKeys.kept);
            replacedKeys.pending = false;
        }
        if (replacedRows != undefined) {
            await this.putBackUserRows(replacedRows);
            replacedRows.pending = false;
        }
    }

    /**
     * Writes back the encryption keys and the rows of the users a restore keeps that are still to be written
     * back, and leaves each to the next start when that fails.
     * @param keys - The keys the restore keeps, if any.
     * @param rows - The rows of the users the restore keeps of a resource, if any.
     */
    private async tryPutBackKept(keys: KeysAcrossRestore | undefined, rows: UserRowsAcrossRestore | undefined): Promise<void> {
        if (keys?.pending === true) {
            await this.tryPutBackKeptKeys(keys);
        }
        if (rows?.pending === true) {
            await this.tryPutBackUserRows(rows);
        }
    }

    /**
     * Invalidates what every instance keeps in memory of what a restore wrote: every cache after a restore of
     * the application, and of a tenant what was cached for it and outside every tenant.
     * @param tenantId - The tenant restored, or undefined for the application.
     * @param backupName - The backup, for the log.
     */
    private async invalidateRestoredCaches(tenantId: string | undefined, backupName: string): Promise<void> {
        const tags: string[] = tenantId == undefined
            ? [CacheRestoreTagUtilities.APPLICATION_TAG]
            : [CacheRestoreTagUtilities.getTenantTag(tenantId), CacheRestoreTagUtilities.UNTENANTED_TAG];
        try {
            await this.cacheService.invalidateTags(tags);
        }
        catch (error) {
            // the data is restored, and the restore is what its caller asked about. This instance's own caches
            // are emptied before the others are told, so what fails is mostly telling them
            this.logger.error(new Error(
                `Could not invalidate the caches after restoring backup "${backupName}". Until their entries expire, `
                + 'caches can answer with what was stored before.',
                { cause: error }
            ));
        }
    }

    /**
     * The encryption keys a restore keeps: those stored now, when it replaces a data source holding them.
     * @param backup - The backup being restored.
     * @param staged - Its resources.
     * @returns The keys, or undefined for a restore of a tenant, which never writes them, or one replacing
     * no data source holding them.
     */
    private async resolveKeysAcrossRestore(
        backup: BackupEntity,
        staged: StagedResource[]
    ): Promise<KeysAcrossRestore | undefined> {
        if (backup.tenantId != undefined || !staged.some(s => this.holdsEncryptionKeys(s.resource))) {
            return undefined;
        }
        const kept: KeptEncryptionKeys | undefined = await this.encryptionService.resolveKeptKeys?.();
        return kept == undefined ? undefined : { kept, pending: false };
    }

    /**
     * Whether a resource is a data source holding encryption keys, which every instance running encrypts
     * or signs with as they were read.
     * @param resource - The resource.
     * @returns Whether it is.
     */
    private holdsEncryptionKeys(resource: BackupResourceInterface): boolean {
        return isDataSource(resource)
            && resource.entities.some(e => e === EncryptionKey || e === EncryptionStrategyEntity || e === SigningKey);
    }

    /**
     * Writes back the encryption keys a restore keeps, and leaves them to the next start when that fails.
     * @param keys - The keys.
     */
    private async tryPutBackKeptKeys(keys: KeysAcrossRestore): Promise<void> {
        try {
            await this.encryptionService.putBackKeptKeys?.(keys.kept);
            keys.pending = false;
        }
        catch (error) {
            this.logger.error(new Error(
                'Could not write back the encryption keys stored before the restore. The next start writes them back.',
                { cause: error }
            ));
        }
    }

    /**
     * Keeps on this instance's disk the rows of the users that exist now, of each data source the restore
     * replaces holding entities declared `backedUp: 'keptForCurrentUsers'`.
     * @param backup - The backup being restored.
     * @param staged - Its resources.
     * @returns What is kept, of each such data source. None for a restore of a tenant, which never writes
     * them, or one replacing no such data source.
     */
    private async stageUserRowsAcrossRestore(
        backup: BackupEntity,
        staged: StagedResource[]
    ): Promise<UserRowsAcrossRestore[]> {
        const holding: StagedResource[] = backup.tenantId == undefined
            ? staged.filter(s => KeptUserRowsUtilities.holdsKeptRows(s.resource))
            : [];
        const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
        const streamUserIds: (() => AsyncIterable<string>) | undefined = userService.streamUserIds?.bind(userService);
        if (!holding.length || streamUserIds == undefined) {
            if (holding.length) {
                this.logger.warn(
                    'The user service streams no user ids, so the restore writes the credentials of the backup, revoked ones among them.'
                );
            }
            return [];
        }
        return await Promise.all(holding.map(async (s): Promise<UserRowsAcrossRestore> => {
            // credentials, so encrypted whether the resource is or not
            const file: StagedFile = this.resolveRestoreStagedFile(
                FsUtilities.getPath(this.stagingFolder, `${backup.id}-${s.entity.id}-user-rows`),
                true
            );
            const digest: BackupDigest = await KeptUserRowsUtilities.stage(s.resource, streamUserIds(), file);
            // on the disk before the journal names it, as a snapshot is
            await FsUtilities.sync(file.path);
            return {
                resource: s.resource,
                file,
                entry: await RestoreJournalUtilities.resolveEntry(s.entity.name, file, digest, this.encryptionService),
                pending: false
            };
        }));
    }

    /**
     * Writes back the rows of the users a restore keeps of a data source, once it replaced the data source.
     * @param rows - The rows.
     */
    private async putBackUserRows(rows: Pick<UserRowsAcrossRestore, 'resource' | 'file'>): Promise<void> {
        const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
        await KeptUserRowsUtilities.putBack(
            rows.resource,
            rows.file,
            async ids => await userService.findStoredUserIds?.(ids) ?? []
        );
    }

    /**
     * Writes back the rows of the users a restore keeps, and leaves them to the next start when that fails.
     * @param rows - The rows.
     */
    private async tryPutBackUserRows(rows: UserRowsAcrossRestore): Promise<void> {
        try {
            await this.putBackUserRows(rows);
            rows.pending = false;
        }
        catch (error) {
            this.logger.error(new Error(
                'Could not write back the credentials of the users stored before the restore. The next start writes them back.',
                { cause: error }
            ));
        }
    }

    /**
     * Whether a staged resource's restore changes everything or nothing by itself, as the resource says of
     * the data it applies.
     * @param s - The resource.
     * @returns Whether it does, false for a resource that does not say.
     */
    private async resolveRestoresWhole(s: StagedResource): Promise<boolean> {
        if (s.resource.resolveRestoresWhole == undefined) {
            return false;
        }
        // the increments too: what changed since the backup in full can hold what decides it, such as the
        // record of a migration that changed no table
        const data: Readable = StagingUtilities.read(s.data);
        const increments: Readable[] = s.increments.map(i => StagingUtilities.read(i));
        try {
            return await s.resource.resolveRestoresWhole(data, increments);
        }
        finally {
            data.destroy();
            for (const increment of increments) {
                increment.destroy();
            }
        }
    }

    /**
     * Applies the staged data of one resource: in full, or in full and each backup after it.
     * @param s - The resource.
     */
    private async applyStagedResource(s: SnapshottedResource): Promise<void> {
        const incremental: IncrementalBackupResourceInterface | undefined = isIncrementalBackupResource(s.resource)
            ? s.resource
            : undefined;
        // before its data is replaced, however that ends: what changed after it no longer builds on any
        // backup, its own writes in replacing it included
        await incremental?.forgetReadCursor();
        if (!s.increments.length) {
            await s.resource.restoreBackup(StagingUtilities.read(s.data), () => StagingUtilities.read(s.data));
            return;
        }
        if (incremental == undefined) {
            throw new InternalError(
                `The resource "${s.entity.name}" needs to implement IncrementalBackupResourceInterface to be restored.`
            );
        }
        await incremental.restoreIncrementalBackup(
            StagingUtilities.read(s.data),
            s.increments.map(i => StagingUtilities.read(i))
        );
    }

    /**
     * Puts the given resources back from their snapshots, the last one applied first, and fails with why.
     * @param touched - The resources to put back, in the order they were applied.
     * @param backup - The backup being restored.
     * @param error - Why the restore ended.
     * @param keys - The encryption keys the restore keeps, if any.
     * @param userRows - The rows of the users the restore keeps.
     * @param options - How the backup is restored.
     * @throws The given error, once every resource is put back.
     * @throws {RestoreNotUndoneError} When a resource could not be put back.
     */
    private async putBack(
        touched: SnapshottedResource[],
        backup: BackupEntity,
        error: unknown,
        keys: KeysAcrossRestore | undefined,
        userRows: UserRowsAcrossRestore[],
        options: RestoreOptions
    ): Promise<never> {
        const [last, ...before] = [...touched].reverse();
        if (options.putBack === false && last != undefined) {
            throw BackupService.resolveNothingPutBackError(touched, last, before, backup, error);
        }
        const notUndone: StagedResource[] = [];
        for (const t of [...touched].reverse()) {
            if (t.snapshotDigest == undefined) {
                // restored alone, all or nothing by itself: its data went in whole or not at all, and only
                // what runs after it, such as bringing its uniques in line, can have failed with it in place
                throw new InternalError(
                    `Restoring "${t.entity.name}" of the backup "${backup.name}" failed, and no copy to put back was kept, since its `
                    + 'restore changes everything or nothing by itself. When it failed after its data went in, '
                    + 'the backup\'s data is in place.',
                    { cause: error }
                );
            }
            try {
                await this.putBackFrom(t.resource, t.snapshot, t.snapshotDigest);
            }
            catch (undoError) {
                this.logger.error(new Error(
                    `Could not put back the resource "${t.entity.name}" after restoring backup "${backup.name}" failed.`,
                    { cause: undoError }
                ));
                notUndone.push(t);
            }
        }
        // put back from their snapshots, the data sources holding keys hold the keys of before once more
        if (keys != undefined && !notUndone.some(t => this.holdsEncryptionKeys(t.resource))) {
            keys.pending = false;
        }
        // and those holding the rows of the users, those rows
        for (const rows of userRows.filter(r => !notUndone.some(t => t.resource === r.resource))) {
            rows.pending = false;
        }
        if (notUndone.length) {
            throw new RestoreNotUndoneError(
                backup,
                notUndone.map(t => ({ name: t.entity.name, snapshotPath: t.snapshot.path })),
                error
            );
        }
        throw error;
    }

    /**
     * The failure of a restore that kept no copies to put back from, naming what each resource it touched holds.
     * @param touched - The resources the restore touched, in the order they were applied.
     * @param last - The resource applied last.
     * @param before - The resources applied before it, the last one applied first.
     * @param backup - The backup being restored.
     * @param error - Why the restore ended.
     * @returns The error.
     */
    private static resolveNothingPutBackError(
        touched: SnapshottedResource[],
        last: SnapshottedResource,
        before: SnapshottedResource[],
        backup: BackupEntity,
        error: unknown
    ): InternalError {
        // stopped between two resources, every one touched is applied whole
        const stopped: boolean = error instanceof RestoreStoppedError;
        const touchedNames: string = touched.map(t => `"${t.entity.name}"`).join(', ');
        const beforeNames: string = [...before].reverse()
            .map(t => `"${t.entity.name}"`)
            .join(', ');
        const beforeHold: string = before.length ? `${beforeNames} hold the backup's data, and ` : '';
        const stoppedHeadline: string = `The restore of backup "${backup.name}" was stopped because the application is shutting down, `
            + 'and nothing was put back,';
        return new InternalError(
            [
                stopped
                    ? stoppedHeadline
                    : `Restoring "${last.entity.name}" of the backup "${backup.name}" failed, and nothing was put back,`,
                'since the restore kept no copies to put back from (putBack: false).',
                stopped
                    ? `${touchedNames} hold the backup's data, and the others what they held before.`
                    : `${beforeHold}"${last.entity.name}" holds what the restore got to.`,
                'Restore the backup again once the cause below is fixed.'
            ],
            { cause: error }
        );
    }

    /**
     * Puts a resource back from its snapshot, once the snapshot is found to be what was written.
     * @param resource - The resource.
     * @param snapshot - Where its snapshot is kept, and how it is stored.
     * @param written - What the snapshot held when it was written.
     * @throws When the snapshot is not what was written, or putting it back fails.
     */
    private async putBackFrom(resource: BackupResourceInterface, snapshot: StagedFile, written: BackupDigest): Promise<void> {
        // a snapshot cut short is what the resource held with its end missing, and putting it back
        // would take what is there and leave less. Checked the way a fetched archive is
        const found: BackupDigest = await StagingUtilities.resolveDigest(snapshot);
        if (found.checksum !== written.checksum || found.size !== written.size) {
            throw new InternalError(
                `The snapshot ${snapshot.path} is not what the restore wrote:`
                + ` it holds ${found.size} of ${written.size} bytes, or other ones.`
            );
        }
        await resource.restoreBackup(StagingUtilities.read(snapshot), () => StagingUtilities.read(snapshot));
    }

    /**
     * Fetches a resource's data to this instance's disk and checks it against what the backup recorded:
     * of the backup alone, or of every backup a restore of it applies.
     * @param resource - The resource as the backup records it.
     * @param backup - The backup being restored.
     * @returns The staged resource, or undefined when this application does not know the resource.
     * @throws When the data is not what the backup recorded, or cannot be fetched or decrypted.
     */
    private async stageResource(resource: BackupResourceEntity, backup: BackupEntity): Promise<StagedResource | undefined> {
        const r: BackupResourceInterface | undefined = this.resolveBackupResource(resource);
        if (!r) {
            this.logger.warn(
                `Problem while restoring backup "${backup.name}". Could not find backup resource "${resource.name}"`
            );
            return;
        }
        const transports: BackupTransportInterface[] = await this.resolveScopedTransports(backup, resource);
        if (!transports.length) {
            this.logger.warn(
                `Problem while restoring backup "${backup.name}". Could not find transports for backup resource "${resource.name}"`
            );
            return;
        }
        const chain: ChainLink[] = await this.resolveRestoredChain(backup, resource);
        if (chain.length > 1 && !isIncrementalBackupResource(r)) {
            throw new InternalError(
                `The backup "${backup.name}" holds what changed of "${resource.name}", which needs to implement `
                + 'IncrementalBackupResourceInterface to be restored.'
            );
        }
        // before anything is fetched, because a record saying a backup never finished is an answer that
        // costs nothing to reach - and reaching it afterwards is a download spent on saying no
        for (const link of chain) {
            if (!link.resource.completed || link.resource.checksum == undefined || link.resource.size == undefined) {
                throw new IncompleteBackupError(link.backup, link.resource);
            }
        }
        // a resource whose data is encrypted is so on this instance's disk as well: what was fetched of it, and
        // the snapshot of what it holds now
        const encrypt: boolean = MetadataUtilities.getBackupResourceMetadata(r)?.encrypt === true
            || chain.some(link => link.resource.encryptedKey != undefined);
        const paths: FsPath[] = [];
        const files: (StagedFile | StagedChunksFile)[] = [];
        try {
            for (const link of chain) {
                const p: FsPath = this.stagingPathFor(link.backup, link.resource);
                paths.push(p);
                files.push(await this.stageResourceData(link.resource, link.backup, transports, p, encrypt));
            }
        }
        catch (error) {
            await Promise.all(paths.map(async p => await FsUtilities.rm(p)));
            throw error;
        }
        const [data, ...increments] = files;
        if (data == undefined) {
            throw new InternalError(`Could not stage the resource "${resource.name}" of the backup "${backup.name}".`);
        }
        return {
            entity: resource,
            // of a backup of a tenant, the tenant's rows: those are what is snapshotted and replaced
            resource: this.resolveScopedResource(backup, r),
            data,
            increments,
            snapshot: this.resolveRestoreStagedFile(FsUtilities.getPath(this.stagingFolder, `${backup.id}-${resource.id}-before`), encrypt)
        };
    }

    /**
     * A file a restore stages on this instance's disk: compressed, and encrypted under a key of its own when
     * its resource is encrypted.
     * @param p - Where it is.
     * @param encrypt - Whether its resource is encrypted.
     * @returns The file.
     */
    private resolveRestoreStagedFile(p: FsPath, encrypt: boolean): StagedFile {
        return {
            path: p,
            compression: RESTORE_STAGING_COMPRESSION,
            encryption: encrypt ? BackupEncryptionUtilities.generateStagedFileEncryption() : undefined
        };
    }

    /**
     * Resolves the backups a restore of a resource applies: the backup in full it builds on, and each one
     * after it up to the restored one.
     * @param backup - The backup restored.
     * @param resource - The resource as it records it.
     * @returns The backups, the one in full first; the restored one alone when it holds the resource in full.
     * @throws When a backup it builds on is no longer recorded.
     */
    private async resolveRestoredChain(backup: BackupEntity, resource: BackupResourceEntity): Promise<ChainLink[]> {
        const link: ChainLink = { backup, resource };
        if (resource.baseBackupId == undefined) {
            return [link];
        }
        const completed: BackupEntity[] = await this.backupRepository.findAll({
            where: { status: BackupStatus.COMPLETED },
            relations: ['resources'],
            limit: 'all'
        });
        const chain: ChainLink[] | undefined = this.findChain(link, completed);
        if (chain == undefined) {
            throw new InternalError(
                `The backup "${backup.name}" holds what changed of "${resource.name}" since a backup that is no longer recorded.`
            );
        }
        return chain;
    }

    /**
     * Fetches the data of one resource of one backup to this instance's disk and checks it against what the
     * backup recorded.
     * @param resource - The resource as the backup records it, completed.
     * @param backup - The backup.
     * @param transports - The transports of the resource.
     * @param p - Where to stage it.
     * @param encrypt - Whether to encrypt it on this instance's disk.
     * @returns The staged file, and how it is stored.
     * @throws When the data is not what the backup recorded, or cannot be fetched or decrypted.
     */
    private async stageResourceData(
        resource: BackupResourceEntity,
        backup: BackupEntity,
        transports: BackupTransportInterface[],
        p: FsPath,
        encrypt: boolean
    ): Promise<StagedFile | StagedChunksFile> {
        // before anything is fetched as well: a master key this application no longer holds is the
        // same kind of answer
        const key: Buffer | undefined = resource.encryptedKey == undefined
            ? undefined
            : Buffer.from(await this.encryptionService.masterDecrypt(resource.encryptedKey), 'base64');

        // fetched to this instance's own disk, so the transport is read once however many passes the
        // check and the restore take between them. Checking while restoring would read it once too,
        // but could only say afterwards that what it had already applied was wrong - and a restore
        // recovering from a bad change has a current state worth not destroying over an archive that
        // turns out to be unusable. Decrypted on the same pass, which is why the chunks authenticating
        // is enough: nothing reaches the resource until every one of them has.
        // One transport after another: a copy that turns out broken on one, such as a chunk gone from it,
        // is no reason to refuse a copy another one holds whole
        let refused: unknown;
        for (const transport of transports) {
            let retrieved: RetrievedBackupResource;
            try {
                retrieved = await this.resolveRetrieved([transport], resource, backup, key);
            }
            catch {
                // warned about by resolveRetrieved
                continue;
            }
            try {
                return await this.stageRetrieved(retrieved, resource, backup, key, p, encrypt);
            }
            catch (error) {
                await FsUtilities.rm(p);
                // another transport stages onto the same disk
                if (this.stopping.signal.aborted || BackupService.isOutOfSpace(error)) {
                    throw error;
                }
                refused = error;
                this.logger.warn(
                    `Could not restore "${resource.name}" of the backup "${backup.name}" from the transport "${transport.name}": `
                    + (error instanceof Error ? error.message : String(error))
                );
            }
        }
        // what the last transport threw, rethrown unchanged as a catch block would
        // eslint-disable-next-line typescript/only-throw-error
        throw refused ?? new InternalError(`Could not resolve backup data for resource "${resource.name}".`);
    }

    /**
     * Stages the data of one resource of one backup, as one transport handed it over, and checks it against
     * what the backup recorded.
     * @param retrieved - The data, as the transport handed it over.
     * @param resource - The resource as the backup records it, completed.
     * @param backup - The backup.
     * @param key - The key the backup recorded for the resource, decrypted, if any.
     * @param p - Where to stage it.
     * @param encrypt - Whether to encrypt it on this instance's disk, when it arrives in one piece.
     * @returns The staged file, and how it is stored.
     * @throws When the data is not what the backup recorded, or cannot be fetched or decrypted.
     */
    private async stageRetrieved(
        retrieved: RetrievedBackupResource,
        resource: BackupResourceEntity,
        backup: BackupEntity,
        key: Buffer | undefined,
        p: FsPath,
        encrypt: boolean
    ): Promise<StagedFile | StagedChunksFile> {
        if (retrieved.kind === 'chunks') {
            // summed from the chunks its manifest lists, before any of them is fetched: each chunk is
            // checked against its id as it arrives, and a chunk that is not refuses the whole
            if (retrieved.checksum !== resource.checksum || retrieved.size !== resource.size) {
                retrieved.chunks.destroy();
                throw new CorruptBackupError(backup, resource, { checksum: retrieved.checksum, size: retrieved.size });
            }
            // as they were stored: compressed already, and for an encrypted resource encrypted with the repository key
            const chunksFile: StagedChunksFile = { path: p, compression: 'chunks', key: retrieved.key, size: retrieved.size };
            await this.stopOnShutdown(retrieved.chunks, async () => await StagingUtilities.writeChunks(retrieved.chunks, chunksFile));
            return chunksFile;
        }
        // a key of its own for each attempt: a stream cipher writing a copy that differs under the same key
        // as one before it gives away where they differ
        const file: StagedFile = this.resolveRestoreStagedFile(p, encrypt);
        // in one piece it arrives as stored, and is summed that way
        const digest: BackupDigest = await this.stopOnShutdown(retrieved.data, async () => await StagingUtilities.stage(
            retrieved.data,
            file,
            key ? source => BackupEncryptionUtilities.decrypt(source, key) : undefined
        ));
        if (digest.checksum !== resource.checksum || digest.size !== resource.size) {
            throw new CorruptBackupError(backup, resource, digest);
        }
        return file;
    }

    /**
     * Writes the record of a finished backup beside the data it describes.
     *
     * Read back rather than reused, because what is worth storing is the state every resource ended
     * in - how large each one turned out and what it sums to - and none of that exists on the entity
     * the backup started as.
     *
     * The copy the transports hold is the one a restore has when the database holding the other one
     * is the thing being restored, which is the case this is for.
     * @param backup - The backup that finished, with its resources.
     */
    private async storeMetadata(backup: BackupEntity): Promise<void> {
        const transports: BackupTransportInterface[] = (await Promise.all(
            backup.resources.map(async r => await this.resolveScopedTransports(backup, r))
        )).flat();
        // written here rather than by each transport, so that what a record is stays one thing said
        // in one place however many transports hold a copy of it
        const document: string = JsonUtilities.stringify(backup);
        await Promise.all([...new Set(transports)].map(async t => {
            const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(t);
            await (this.isFormat2(backup) && store != undefined
                ? this.format2.storeRecord(store, backup, document)
                : t.storeMetadata(backup, document));
        }));
    }

    /**
     * Sends one resource's data to every transport meant to hold it, measuring it on the way past.
     *
     * Written to this instance's own disk first, and followed from there by each transport while it
     * is still being written. Two things come out of that. A transport reads its own copy, where
     * handing all of them the same stream had them race over its chunks and write at least one
     * archive short. And whatever is producing the data runs at the speed of the disk rather than of
     * the slowest transport - which for a database dump is the difference between holding its
     * snapshot open for as long as the dump takes and holding it open for as long as an upload does.
     * @param data - The resource's backup data.
     * @param transports - Where it is to be stored.
     * @param backup - The backup being created.
     * @param resource - The resource being stored.
     * @returns What was written, for a restore to check its copy against.
     */
    private async storeAndMeasure(
        data: Readable,
        transports: BackupTransportInterface[],
        backup: BackupEntity,
        resource: BackupResourceEntity
    ): Promise<BackupDigest> {
        const p: FsPath = this.stagingPathFor(backup, resource);
        await FsUtilities.mkdir(this.stagingFolder);
        // so that a reader can stat it before the writer has opened it
        await FsUtilities.createFile(p, '');

        try {
            // as it is: the transports store the file byte for byte, and the data is the archive format 1 stores
            const staged: Promise<BackupDigest> = StagingUtilities.stage(data, { path: p, compression: 'none', encryption: undefined });
            const stored: Promise<void>[] = transports.map(async t => {
                const followed: Readable = Readable.from(StagingUtilities.followFile(p, staged));
                const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(t);
                // in one piece under the folder of the repository, where the record of a backup in format 2 is
                await (this.isFormat2(backup) && store != undefined
                    ? this.format2.storeWhole(store, backup, resource, followed)
                    : t.storeData(followed, backup, resource));
            });

            const [digest]: [BackupDigest, ...void[]] = await Promise.all([staged, ...stored]);
            return digest;
        }
        finally {
            await FsUtilities.rm(p);
        }
    }

    /**
     * Where a resource's data is written while it is on its way somewhere.
     * @param backup - The backup the data belongs to.
     * @param resource - The resource the data is of.
     * @returns The path to stage it at.
     */
    private stagingPathFor(backup: BackupEntity, resource: BackupResourceEntity): FsPath {
        // ids rather than names, which are a date by default and a caller's string otherwise - and
        // neither is something a file name can hold whatever it turns out to be
        return FsUtilities.getPath(this.stagingFolder, `${backup.id}-${resource.id}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(backup: BackupEntity): Promise<void> {
        await this.validateNotBuiltOn(backup);
        // resolved before anything is deleted, and refused rather than skipped: a resource whose transports
        // are unknown here would keep its data after the record pointing at it is gone, and nothing would
        // ever clean that up. Refused, the backup stays whole and can be deleted once they are known again
        const targets: [BackupResourceEntity, BackupTransportInterface[]][] = await Promise.all(
            backup.resources.map(async (resource): Promise<[BackupResourceEntity, BackupTransportInterface[]]> => {
                const transports: BackupTransportInterface[] = await this.resolveScopedTransports(backup, resource);
                if (!transports.length) {
                    throw new InternalError(
                        `Could not delete the backup "${backup.name}": the transports of its resource "${resource.name}" are unknown.`
                    );
                }
                return [resource, transports];
            })
        );

        // the record first, the reverse of how a backup is stored: a delete that is interrupted leaves data
        // without a record, which is what an unfinished backup looks like, and the sync does not bring it back
        const transports: BackupTransportInterface[] = [...new Set(targets.flatMap(([, t]) => t))];
        await Promise.all(transports.map(async t => {
            const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(t);
            await (this.isFormat2(backup) && store != undefined ? this.format2.deleteRecord(store, backup) : t.deleteMetadata(backup));
        }));
        await Promise.all(targets.flatMap(([resource, resourceTransports]) => {
            return resourceTransports.map(async t => await this.deleteResourceData(t, backup, resource));
        }));

        // together: a backup left without its resources would restore nothing, and report that as a success
        const transaction: Transaction = await this.backupRepository.dataSource.startTransaction();
        try {
            await this.backupResourceRepository.deleteAll({ backupId: backup.id }, { transaction });
            await this.backupRepository.deleteById(backup.id, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Validates that no backup builds on a backup about to be deleted: one completed, or one being taken,
     * whose resource holds what changed since it.
     * @param backup - The backup.
     * @throws {ConflictError} When one does.
     */
    private async validateNotBuiltOn(backup: BackupEntity): Promise<void> {
        const building: BackupResourceEntity[] = await this.backupResourceRepository.findAll({
            where: { baseBackupId: backup.id },
            relations: ['backup'],
            limit: 'all'
        });
        // a failed backup is restored by nobody, and needs nothing of what it built on
        const names: string[] = [...new Set(building.filter(r => r.backup.status !== BackupStatus.FAILED).map(r => r.backup.name))];
        if (names.length) {
            throw new ConflictError(
                $ts`The backup ${backup.name} cannot be deleted while backups build on it: ${names.join(', ')}. Delete those first.`
            );
        }
    }

    /**
     * Deletes what a transport holds of one resource of a backup. Of a backup in format 2 that leaves the
     * chunks, which other backups may share.
     * @param transport - The transport.
     * @param backup - The backup.
     * @param resource - The resource.
     */
    private async deleteResourceData(
        transport: BackupTransportInterface,
        backup: BackupEntity,
        resource: BackupResourceEntity
    ): Promise<void> {
        const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(transport);
        await (this.isFormat2(backup) && store != undefined
            ? this.format2.deleteResources(store, backup, [resource])
            : transport.deleteData(backup, resource));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    exportTenant(tenantId: string, format: TenantExportFormat): Readable {
        if (!UUIDUtilities.isUuid(tenantId)) {
            throw new BadRequestError($ts`The tenant of an export needs to be a uuid.`);
        }
        return Readable.from(TenantExportUtilities.resolveArchive(this.dataSources, tenantId, format, this.stagingFolder));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRecordedBackups(): Promise<BackupEntity[]> {
        // an application that backs nothing up is not asked to declare the backup entities, so there
        // is no table to read
        return !this.backupResources.length ? [] : await this.backupRepository.findAll({ limit: 'all' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveBackupResource(resource: BackupResourceEntity): BackupResourceInterface | undefined {
        return this.findBackupResource(resource.name);
    }

    /**
     * Finds the backup resource of the given name.
     * @param name - The name a backup records the resource under.
     * @returns The resource, or undefined when the application has none of that name.
     */
    private findBackupResource(name: string): BackupResourceInterface | undefined {
        // by the name the decorator settled on, which is what a backup records: a resource given a name
        // of its own was never found by its class name
        return this.backupResources.find(r => MetadataUtilities.getBackupResourceMetadata(r)?.name === name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTransports(resource: BackupResourceEntity): BackupTransportInterface[] | undefined {
        const resourceClass: BackupResourceInterface | undefined = this.resolveBackupResource(resource);
        if (!resourceClass) {
            return;
        }
        const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resourceClass);
        if (!metadata) {
            return;
        }
        return this.resolveTransportsFromMetadata(metadata);
    }

    /**
     * The transports a resource of a backup is stored on: of the application, those of the resource; of a
     * tenant, the tenant's own it was queued with.
     * @param backup - The backup.
     * @param resource - The resource as the backup records it.
     * @returns The transports this application knows of them.
     */
    private async resolveScopedTransports(
        backup: Pick<BackupEntity, 'tenantId'>,
        resource: BackupResourceEntity
    ): Promise<BackupTransportInterface[]> {
        if (backup.tenantId == undefined) {
            return this.resolveTransports(resource) ?? [];
        }
        const ids: string[] = resource.transportNames
            .filter(n => n.startsWith(TENANT_TRANSPORT_NAME_PREFIX))
            .map(n => n.slice(TENANT_TRANSPORT_NAME_PREFIX.length));
        return !ids.length || !this.tenantTransportsDeclared
            ? []
            : (await this.tenantTransportRepository.findAll({
                where: { id: { oneOf: ids } },
                acrossTenants: true,
                limit: 'all'
            })).map(t => this.toTenantTransport(t));
    }

    /**
     * The transports a tenant configured for its backups.
     * @param tenantId - The tenant.
     * @returns The transports, none when the application declares no TenantBackupTransport.
     */
    private async resolveTenantTransports(tenantId: string): Promise<BackupTransportInterface[]> {
        if (!this.tenantTransportsDeclared) {
            return [];
        }
        const rows: TenantBackupTransport[] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await this.tenantTransportRepository.findAll({ limit: 'all' })
        );
        return rows.map(t => this.toTenantTransport(t));
    }

    /**
     * What a tenant's transport is stored through: its sessions under the layout every backup uses, the
     * same one each time for the same row.
     * @param transport - The tenant's transport, its secret decrypted.
     * @returns The transport.
     */
    private toTenantTransport(transport: TenantBackupTransport): BackupTransportInterface {
        const known: BackupTransportInterface | undefined = this.tenantTransports.get(transport.id);
        if (known != undefined) {
            return known;
        }
        const created: BackupTransportInterface = new Format1BackupTransport(
            new TenantRowBackupTransport(transport, inject(ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS))
        );
        this.tenantTransports.set(transport.id, created);
        return created;
    }

    private get tenantTransportRepository(): Repository<TenantBackupTransport> {
        return inject(repositoryTokenFor(TenantBackupTransport));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTenantBackupTransport(tenantId: string, data: TenantBackupTransportCreateData): Promise<TenantBackupTransport> {
        this.validateTenantTransportsDeclared();
        await this.validateTenantTransport(data);
        const { secret, ...settings } = data;
        const created: TenantBackupTransport = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
            const row: TenantBackupTransport = await this.tenantTransportRepository.create({
                ...settings,
                secret: JsonUtilities.stringify(secret)
            });
            return await this.tenantTransportRepository.findById(row.id);
        });
        // written and deleted at once, so that a wrong address, bucket or secret fails here rather than at the
        // first backup, whose failing nobody may be watching
        const store: TenantRowBackupTransport = new TenantRowBackupTransport(
            created,
            inject(ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS)
        );
        try {
            const session: BackupTransportSessionInterface = await store.openSession();
            try {
                const probe: string = `${BACKUP_REPOSITORY_FOLDER}/probe-${UUIDUtilities.generate()}`;
                await session.put(probe, Readable.from([Buffer.from('zibri')]));
                await session.delete([probe]);
            }
            finally {
                await session.close();
            }
        }
        catch (error) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                tenantId,
                async () => await this.tenantTransportRepository.deleteById(created.id)
            );
            throw new BadRequestError(
                $ts`The transport ${data.name} could not be written to: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTenantBackupTransports(tenantId: string): Promise<TenantBackupTransport[]> {
        this.validateTenantTransportsDeclared();
        return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await this.tenantTransportRepository.findAll({ limit: 'all' })
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteTenantBackupTransport(tenantId: string, id: string): Promise<void> {
        this.validateTenantTransportsDeclared();
        // the tenant's own first: the backups stored on a transport of another tenant are none of its business
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await this.tenantTransportRepository.findById(id)
        );
        const name: string = `${TENANT_TRANSPORT_NAME_PREFIX}${id}`;
        // a backup on it would lose the one place it is stored, and with its record the way to it
        const storing: BackupResourceEntity[] = (await this.backupResourceRepository.findAll({
            where: { transportNames: { includes: [name] } },
            relations: ['backup'],
            limit: 'all'
        })).filter(r => r.backup.status !== BackupStatus.FAILED);
        if (storing.length) {
            const backupNames: string = [...new Set(storing.map(r => r.backup.name))].join(', ');
            throw new ConflictError($ts`The transport is stored on by backups: ${backupNames}. Delete those first.`);
        }
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await this.tenantTransportRepository.deleteById(id)
        );
        this.tenantTransports.delete(id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async setTenantBackupRetention(tenantId: string, retention: BackupRetention | undefined): Promise<void> {
        if (!this.tenantSettingsDeclared) {
            throw new InternalError(
                'The retention of a tenant is stored in TenantBackupSettings, which needs to be declared beside BackupEntity.'
            );
        }
        if (retention != undefined) {
            BackupRetentionUtilities.validateRetention(retention);
        }
        const settings: Repository<TenantBackupSettings> = inject(repositoryTokenFor(TenantBackupSettings));
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
            const stored: TenantBackupSettings | undefined = await settings.findOne({ required: false });
            await (stored == undefined
                ? settings.create({ retention: retention ?? null })
                : settings.updateById(stored.id, { retention: retention ?? null }));
        });
    }

    private validateTenantTransportsDeclared(): void {
        if (!this.tenantTransportsDeclared) {
            throw new InternalError(
                'The transports of tenants are stored in TenantBackupTransport, which needs to be declared beside BackupEntity.'
            );
        }
    }

    /**
     * Validates what a tenant configures as a transport: of a kind the application lists, its settings and its
     * secret as the models of the kind describe them, and as the kind checks them beyond.
     * @param data - What the tenant configures.
     * @throws {BadRequestError} When it is not.
     */
    private async validateTenantTransport(data: TenantBackupTransportCreateData): Promise<void> {
        const options: TenantBackupTransportOptions = inject(ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS);
        const kind: AnyTenantBackupTransportKind | undefined = options.kinds.find(k => k.name === data.kind);
        if (kind == undefined) {
            throw new BadRequestError($ts`A transport needs to be one of ${options.kinds.map(k => k.name).join(', ')}.`);
        }
        // read the way a json body of the model is, since it is what a tenant sends as one
        const validation: ValidationServiceInterface = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);
        await validation.validateBody(
            data.settings,
            resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: kind.settingsModel }, 0)
        );
        await validation.validateBody(
            data.secret,
            resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: kind.secretModel }, 0)
        );
        kind.validateSettings?.(data.settings, data.secret, { allowPrivateNetworks: options.allowPrivateNetworks });
    }

    private resolveTransportsFromMetadata(metadata: BackupResourceMetadata): BackupTransportInterface[] {
        if (metadata.transports === 'all') {
            return this.resolveRegisteredTransports();
        }
        return metadata.transports.map(t => {
            const transport: BackupTransportInterface | undefined = this.findFormat1Transport(inject(t));
            if (transport == undefined) {
                throw new InternalError(
                    `The backup transport ${t.name} of "${metadata.name}" needs to implement BackupTransportInterface<'v2'>.`
                );
            }
            return transport;
        });
    }

    /**
     * Warns about every registered transport 4.0 no longer takes: one of `v1` of `BackupTransportInterface` alone, one
     * built on `BaseFsBackupTransport`, `BaseS3BackupTransport` or `BaseSftpBackupTransport`, and one built on a
     * shipped transport that overrides a member of `v1`, which a transport used as `v2` is not called with.
     */
    private warnAboutFormat1Transports(): void {
        // TODO 4.0: refuse the first two, with v1 of BackupTransportInterface and the Base transports gone
        const members: (keyof BackupTransportVersionMembers['v1'])[] = [
            'resolveBackups',
            'storeData',
            'storeMetadata',
            'retrieveData',
            'deleteData',
            'deleteMetadata'
        ];
        const deprecatedBases: [Function, string][] = [
            [BaseFsBackupTransport, 'FsBackupTransport'],
            [BaseS3BackupTransport, 'S3BackupTransport'],
            [BaseSftpBackupTransport, 'SftpBackupTransport']
        ];
        for (const provider of getRegisteredProvidersOfVariant(DiVariants.BACKUP_TRANSPORT)) {
            const transport: unknown = inject(provider.token);
            const deprecatedBase: [Function, string] | undefined = deprecatedBases.find(([base]) => transport instanceof base);
            if (deprecatedBase != undefined && isBackupTransport(transport)) {
                this.logger.warn(
                    `The backup transport "${transport.name}" is built on ${deprecatedBase[0].name}, which 4.0 no longer has. `
                    + `Use ${deprecatedBase[1]} instead.`
                );
            }
            if (!isBackupTransport(transport, 'v2')) {
                if (isBackupTransport(transport)) {
                    this.logger.warn(
                        `The backup transport "${transport.name}" supports v1 of BackupTransportInterface alone, `
                        + 'which 4.0 no longer takes. Implement BackupTransportInterface<\'v2\'> instead.'
                    );
                }
                continue;
            }
            // a shipped transport defines them once, in BaseBackupTransport, so one defined below it is the
            // application's own, written for when the shipped transports called them
            const overridden: string[] = transport instanceof BaseBackupTransport
                ? members.filter(member => Reflect.get(transport, member) !== Reflect.get(BaseBackupTransport.prototype, member))
                : [];
            if (overridden.length) {
                this.logger.warn(
                    `The backup transport "${transport.name}" defines ${overridden.join(', ')}, which a transport used as v2 is not `
                    + 'called with. Override openSession instead, or set its versions to [\'v1\'] to keep them in use until 4.0.'
                );
            }
        }
    }

    /**
     * Every transport the application registered, as format 1 is written through.
     * @returns The transports.
     */
    private resolveRegisteredTransports(): BackupTransportInterface[] {
        return getRegisteredProvidersOfVariant(DiVariants.BACKUP_TRANSPORT).flatMap(provider => {
            const transport: BackupTransportInterface | undefined = this.findFormat1Transport(inject(provider.token));
            return transport == undefined ? [] : [transport];
        });
    }

    /**
     * What format 1 is written through for a registered transport: the sessions of one supporting `v2`, the newest,
     * under the layout of format 1, or a transport of `v1` alone as it is.
     * @param transport - The transport.
     * @returns The transport format 1 is written through, the same one each time for the same transport,
     * or undefined when the value is no transport.
     */
    private findFormat1Transport(transport: unknown): BackupTransportInterface | undefined {
        if (isBackupTransport(transport, 'v2')) {
            // the same one each time: the record is stored once per transport a backup went to, which is
            // told apart by identity
            const known: BackupTransportInterface = this.format1Transports.get(transport)
                ?? new Format1BackupTransport(transport);
            this.format1Transports.set(transport, known);
            return known;
        }
        // TODO 4.0: remove v1 of BackupTransportInterface, and with it this path
        return isBackupTransport(transport) ? transport : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveData(
        transports: BackupTransportInterface[],
        resource: BackupResourceEntity,
        backup: BackupEntity
    ): Promise<Readable> {
        const retrieved: RetrievedBackupResource = await this.resolveRetrieved(transports, resource, backup, undefined);
        return retrieved.kind === 'chunks'
            ? Readable.from(BackupChunkUtilities.openAll(retrieved.chunks, retrieved.key))
            : retrieved.data;
    }

    /**
     * Fetches the data of a resource from the first of its transports that hands it over.
     * @param transports - The transports, in the order they are tried.
     * @param resource - The resource.
     * @param backup - The backup.
     * @param key - The key the backup recorded for the resource, decrypted, if any.
     * @returns The data, rebuilt from its chunks or as it was stored in one piece.
     * @throws When no transport hands it over.
     */
    private async resolveRetrieved(
        transports: BackupTransportInterface[],
        resource: BackupResourceEntity,
        backup: BackupEntity,
        key: Buffer | undefined
    ): Promise<RetrievedBackupResource> {
        for (const transport of transports) {
            try {
                return await this.resolveRetrievedFrom(transport, resource, backup, key);
            }
            catch (error) {
                this.logger.warn(
                    [
                        `Could not resolve backup data for resource "${resource.name}" from transport: ${transport.name}.`,
                        'Cause:',
                        error instanceof Error ? error.message : JsonUtilities.stringify(error)
                    ].join('\n')
                );
            }
        }

        throw new InternalError(`Could not resolve backup data for resource "${resource.name}".`);
    }

    /**
     * Fetches the data of a resource from one transport, in the layout of the backup's format.
     * @param transport - The transport.
     * @param resource - The resource.
     * @param backup - The backup.
     * @param key - The key the backup recorded for the resource, decrypted, if any.
     * @returns The data, rebuilt from its chunks or as it was stored in one piece.
     * @throws When the transport does not hand it over.
     */
    private async resolveRetrievedFrom(
        transport: BackupTransportInterface,
        resource: BackupResourceEntity,
        backup: BackupEntity,
        key: Buffer | undefined
    ): Promise<RetrievedBackupResource> {
        const store: BackupTransportSupporting<'v2'> | undefined = this.findStore(transport);
        if (!this.isFormat2(backup) || store == undefined) {
            return { kind: 'whole', data: await transport.retrieveData(backup, resource) };
        }
        try {
            return await this.format2.retrieve(store, backup, resource, key);
        }
        catch (error) {
            if (!(error instanceof BackupKeyNotFoundError)) {
                throw error;
            }
            // during a rolling deploy from 3.0, an instance of 3.0 claims the resources of a backup this build
            // queued in format 2 and stores them in format 1, under the key of their own it records on the
            // resource. Checked against the size and checksum the resource records like any other copy
            try {
                return { kind: 'whole', data: await transport.retrieveData(backup, resource) };
            }
            catch (format1Error) {
                // missing in both layouts: the layout of the backup's format is the one worth naming
                throw format1Error instanceof BackupKeyNotFoundError ? error : format1Error;
            }
        }
    }
}