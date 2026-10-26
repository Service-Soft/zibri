import { Readable } from 'node:stream';

import { BehaviorSubject, first, firstValueFrom } from 'rxjs';

import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupFailedError } from './backup-failed.error';
import { READABLE_BACKUP_FORMAT_VERSIONS } from './backup-format';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BackupResourceInterface, isBackupResource } from './backup-resource.interface';
import { BackupCreateData, BackupServiceInterface } from './backup-service.interface';
import { BackupStagingCleanupCronJob } from './backup-staging-cleanup.cron-job';
import { BackupStatus } from './backup-status.enum';
import { RunQueuedBackupsCronJob } from './run-queued-backups.cron-job';
import { RestoreJournalEntry } from './restore-journal-entry.model';
import { RestoreJournal } from './restore-journal.model';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { BackupDigest, followFile, stage } from './staging.function';
import { ZibriApplication } from '../application/application';
import { BackupResourceMetadata } from './decorators/backup-resource-metadata.model';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { BackupTransportInterface, isBackupTransport } from './transports/backup-transport.interface';
import { type EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { KeysInUse } from '../auth/encryption/keys-in-use.model';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { parseObject } from '../parsing/functions/parse-object.function';
import { WakeUpListener } from '../polling/wake-up-listener.model';
import { type WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { QueueDefinition } from '../queue/queue-definition.model';
import { QueueUtilities } from '../queue/queue.utilities';
import { QueuedWorkHandedBackError } from '../queue/queued-work-handed-back.error';
import { QueuedWorkOutcome } from '../queue/queued-work-outcome.model';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities, TimeoutError } from '../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * An error to throw during backup service initialization.
 */
class InitBackupServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing backup service.', ...messageArray]);
        this.name = 'InitBackupServiceError';
    }
}

/**
 * An error to throw when no transports could be resolved for the given backup resource.
 */
class BackupTransportNotFoundError extends InternalError {
    constructor(backupResource: BackupResourceInterface) {
        super(`Could not find a transport for the backup resource "${backupResource.constructor.name}"`);
        this.name = 'BackupTransportNotFoundError';
    }
}

/**
 * An error to throw when a backup is written in a shape this build does not know.
 */
class UnreadableBackupError extends InternalError {
    constructor(backup: BackupEntity) {
        super([
            `The backup "${backup.name}" is written in backup format ${backup.formatVersion},`,
            `and this build reads ${READABLE_BACKUP_FORMAT_VERSIONS.join(', ')}.`,
            `It was taken by zibri ${backup.zibriVersion}.`
        ]);
        this.name = 'UnreadableBackupError';
    }
}

/**
 * An error to throw when a backup was never finished being written.
 */
class IncompleteBackupError extends InternalError {
    constructor(backup: BackupEntity, resource: BackupResourceEntity) {
        super([
            `The resource "${resource.name}" of backup "${backup.name}" was never finished.`,
            'Whatever is stored for it is part of a backup rather than one, so there is nothing to restore from.'
        ]);
        this.name = 'IncompleteBackupError';
    }
}

/**
 * An error to throw when stored backup data is not what was written.
 */
class CorruptBackupError extends InternalError {
    constructor(backup: BackupEntity, resource: BackupResourceEntity, found: BackupDigest) {
        super([
            `The stored data of resource "${resource.name}" is not the data backup "${backup.name}" recorded.`,
            `Expected ${resource.size} bytes with checksum ${resource.checksum}.`,
            `Found ${found.size} bytes with checksum ${found.checksum}.`
        ]);
        this.name = 'CorruptBackupError';
    }
}

/**
 * An error to throw when waiting for a backup stops because the application is shutting down.
 */
class BackupStoppedError extends InternalError {
    constructor(backup: BackupEntity) {
        super(
            `Waiting for the backup "${backup.name}" stopped because the application is shutting down. `
            + 'Another instance stores what is left of it.'
        );
        this.name = 'BackupStoppedError';
    }
}

/**
 * An error to throw when a restore was stopped because the application is shutting down.
 */
class RestoreStoppedError extends InternalError {
    constructor(backup: BackupEntity) {
        super(`The restore of backup "${backup.name}" was stopped because the application is shutting down.`);
        this.name = 'RestoreStoppedError';
    }
}

/**
 * How long stopping a running backup or restore may take once the application has stopped waiting for it:
 * deleting what a backup wrote, or putting back what a restore applied.
 */
const STOPPING_TIMEOUT_IN_MS: number = Ms.SECOND * 30;

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
     * Where its data waits.
     */
    path: FsPath,
    /**
     * Where what the resource held before the restore is kept until the restore is done.
     */
    snapshotPath: FsPath
};

/**
 * An error to throw when a restore failed and could not put every resource back the way it was.
 */
class RestoreNotUndoneError extends InternalError {
    /**
     * Where what the resources that could not be put back held before the restore is kept.
     */
    readonly snapshotPaths: FsPath[];

    constructor(backup: BackupEntity, resources: StagedResource[], cause: unknown) {
        const resourceNames: string = resources.map(r => `"${r.entity.name}"`).join(', ');
        super(
            [
                `Restoring backup "${backup.name}" failed, and ${resourceNames}`
                + ' could not be put back the way they were.',
                ...resources.map(r => `What "${r.entity.name}" held before the restore is kept in ${r.snapshotPath}.`)
            ],
            { cause }
        );
        this.name = 'RestoreNotUndoneError';
        this.snapshotPaths = resources.map(r => r.snapshotPath);
    }
}

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
        return this.shutdownWaitInMs + STOPPING_TIMEOUT_IN_MS;
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

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS)
        private readonly shutdownWaitInMs: number
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const backupResources: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.BACKUP_RESOURCE);
        if (backupResources.length) {
            if (!app.options.cronJobs.includes(BackupStagingCleanupCronJob)) {
                app.options.cronJobs.push(BackupStagingCleanupCronJob);
            }
            if (!app.options.cronJobs.includes(RunQueuedBackupsCronJob)) {
                app.options.cronJobs.push(RunQueuedBackupsCronJob);
            }
            // eslint-disable-next-line stylistic/max-len
            this.logger.info(`configures ${backupResources.length} ${backupResources.length > 1 ? 'resources' : 'resource'} to be backed up:`);
            validateEntitiesRegistered(BackupService.name, app, BackupResourceEntity, BackupEntity);
        }

        for (const provider of backupResources) {
            const resource: unknown = inject(provider.token);
            if (!isBackupResource(resource)) {
                throw new InitBackupServiceError(
                    `Invalid resource marked with @Backup: ${getDiTokenName(provider.token)} needs to implement BackupResourceInterface`
                );
            }
            await resource.validateBackupConfiguration();
            this.backupResources.push(resource);
            if (!MetadataUtilities.getBackupResourceMetadata(resource)?.transports.length) {
                throw new InitBackupServiceError('Needs to have at least one transport defined');
            }
            this.logger.info(`  - ${getDiTokenName(provider.token)}`);
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppInit(): Promise<void> {
        // after every service is initialized rather than during: a transport reads through them, and
        // one in a bucket needs the http client's body parsers, which the parser only registers in its
        // own onAppInit - one that may well run after this service's
        // put back first, because what a half finished restore of the database left there is what the
        // sync would otherwise read
        await this.putBackInterruptedRestores();
        await this.syncBackupEntitiesFrom('skip');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
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
            const notPutBack: RestoreJournalEntry[] = [];
            for (const entry of [...journal.applied].reverse()) {
                try {
                    const resource: BackupResourceInterface | undefined = this.findBackupResource(entry.resourceName);
                    if (!resource) {
                        throw new InternalError(`The application has no backup resource "${entry.resourceName}".`);
                    }
                    await resource.restoreBackup(FsUtilities.createReadStream(entry.snapshotPath));
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
            if (notPutBack.length) {
                await RestoreJournalUtilities.write(p, { ...journal, applied: notPutBack });
                continue;
            }
            await FsUtilities.rm(p);
            this.logger.warn(
                `The restore of backup "${journal.backupName}" was interrupted, and what it had applied was put back: `
                + journal.applied.map(e => `"${e.resourceName}"`).join(', ')
            );
        }
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
        const allTransports: BackupTransportInterface[] = getRegisteredProvidersOfVariant(DiVariants.BACKUP_TRANSPORT)
            .map(t => inject(t.token))
            .filter(isBackupTransport);
        if (!allTransports.length) {
            this.logger.warn('Could not find any transports to sync backup entities from');
            return;
        }
        // every one of them, and it means it: what this answers is which backups the transports hold
        // that are not recorded here, and a partial view of what is recorded would sync the rest a
        // second time
        const existingEntities: BackupEntity[] = await this.backupRepository.findAll({ limit: 'all' });
        const existingNames: string[] = existingEntities.map(e => e.name);
        const resolvedEntities: BackupEntity[] = (await Promise.all(allTransports.map(async t => {
            const documents: string[] = await this.resolveDocuments(t, existingNames, unreachable);
            return documents.map(d => this.toBackupEntity(d, t)).filter(e => e != undefined);
        }))).flat();
        const entitiesToSync: BackupEntity[] = resolvedEntities.filter(entity => !existingEntities.map(e => e.id).includes(entity.id));

        const groupedEntities: Record<string, BackupEntity[]> = this.groupEntitiesById(entitiesToSync);
        const mergedEntities: BackupEntity[] = this.mergeEntities(groupedEntities);
        await PromiseUtilities.allChunked(mergedEntities, e => this.backupRepository.create(e, { allowId: true }));
    }

    /**
     * Reads the records a transport holds.
     * @param transport - The transport to read.
     * @param existingNames - The backups already recorded, which the transport can skip.
     * @param unreachable - Whether a transport that cannot be read fails the sync or is skipped.
     * @returns The records, or none when the transport was skipped.
     */
    private async resolveDocuments(
        transport: BackupTransportInterface,
        existingNames: string[],
        unreachable: 'throw' | 'skip'
    ): Promise<string[]> {
        try {
            return await transport.resolveBackups(existingNames);
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
        return parseObject(document, BackupEntity) as BackupEntity;
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
        const resourceEntities: BackupResourceEntityCreateData[] = [];
        for (const backupResource of this.backupResources) {
            const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(backupResource);
            if (!metadata) {
                throw new BackupTransportNotFoundError(backupResource);
            }
            const transports: BackupTransportInterface[] = this.resolveTransportsFromMetadata(metadata);
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
            ...await this.resolveKeysNeeded(),
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
            dataSource: this.backupResourceRepository.dataSource,
            // how long the resources an instance that stopped existing was storing wait for another
            leaseInMs: Ms.MINUTE,
            onCompletion: 'release',
            claimedPer: 'item',
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
                // eslint-disable-next-line unicorn/no-null
                { completed: false, nextAttemptAt: null, backup: { where: { status: BackupStatus.RUNNING } } },
                { completed: false, nextAttemptAt: { before: new Date() }, backup: { where: { status: BackupStatus.RUNNING } } }
            ],
            relations: ['backup'],
            limit: 'all'
        });
        // one this instance has no resource for is left to an instance that has
        return resources.filter(r => this.findBackupResource(r.name) != undefined);
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
            await this.storeResource(resource.backup, resource);
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
            this.tellWaiting(await this.backupRepository.findById(resource.backupId, { relations: ['resources'] }));
            await this.wakeUpService.wake(this.backupRepository.dataSource, WAKE_UP_TOPICS.backupEnded(resource.backupId));
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
        const backup: BackupEntity = await this.backupRepository.findById(id, { relations: ['resources'] });
        if (backup.status !== BackupStatus.RUNNING || !backup.resources.every(r => r.completed)) {
            return;
        }
        // the record first, the way a backup was always written: a backup whose record is missing
        // is one the transports never finished, and the status says COMPLETED only once they did
        const completed: BackupEntity = { ...backup, status: BackupStatus.COMPLETED };
        await this.storeMetadata(completed);
        await this.backupRepository.updateById(id, { status: BackupStatus.COMPLETED });
        this.tellWaiting(completed);
        await this.wakeUpService.wake(this.backupRepository.dataSource, WAKE_UP_TOPICS.backupEnded(id));
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
        const tell: (ended: BackupEntity) => void = ended => {
            endedHere = ended;
            listener.stop();
        };
        const waitingFor: Set<(ended: BackupEntity) => void> = this.waiting.get(backup.id) ?? new Set();
        waitingFor.add(tell);
        this.waiting.set(backup.id, waitingFor);
        const listener: WakeUpListener = await this.wakeUpService.listen(
            this.backupRepository.dataSource,
            WAKE_UP_TOPICS.backupEnded(backup.id)
        );
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
                // read again every few seconds as well, for an end told through a data source that
                // carries no messages between instances
                await listener.next(Ms.SECOND * 5, this.stopping.signal);
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
     * Resolves the keys a backup taken now will need to be restored.
     *
     * Recorded when the backup is taken rather than worked out later, because which keys were in use
     * then is not something its data says once it is stored.
     * @returns The master keys and the data keys it will need.
     */
    private async resolveKeysNeeded(): Promise<Pick<BackupEntity, 'masterKeys' | 'dataKeyIds'>> {
        const keys: KeysInUse = await this.encryptionService.resolveKeysInUse();
        // a backup holding the key table brings its data keys back with it, encrypted under the master
        // keys of that time. One that does not needs the data keys to still exist, and needs a master
        // key only for its encrypted resources
        if (this.backupResources.includes(keys.dataSource)) {
            return { masterKeys: keys.masterKeys, dataKeyIds: [] };
        }
        const encrypts: boolean = this.backupResources.some(r => MetadataUtilities.getBackupResourceMetadata(r)?.encrypt === true);
        return { masterKeys: encrypts ? [keys.currentMasterKey] : [], dataKeyIds: keys.dataKeyIds };
    }

    /**
     * Stores one resource of a backup on every transport meant to hold it.
     * @param backup - The backup the resource belongs to.
     * @param r - The resource as the backup records it.
     */
    private async storeResource(backup: BackupEntity, r: BackupResourceEntity): Promise<void> {
        const resource: BackupResourceInterface | undefined = this.resolveBackupResource(r);
        if (!resource) {
            throw new InternalError(`Could not find the backup resource "${r.name}" of backup "${backup.name}".`);
        }
        const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resource);
        if (!metadata) {
            throw new BackupTransportNotFoundError(resource);
        }
        const transports: BackupTransportInterface[] = this.resolveTransportsFromMetadata(metadata);
        if (!transports.length) {
            throw new BackupTransportNotFoundError(resource);
        }
        const key: Buffer | undefined = metadata.encrypt ? BackupEncryptionUtilities.generateKey() : undefined;
        // wrapped before the data is produced, so that a master key which cannot be used - a
        // kms that is down, say - fails the attempt before any of it is dumped or uploaded
        const encryptedKey: EncryptionString | undefined = key
            ? await this.encryptionService.masterEncrypt(key.toString('base64'))
            : undefined;
        const data: Readable = await resource.createBackupData(backup);
        // before staging, so that neither this instance's disk nor any transport ever holds
        // the data unencrypted
        const stored: Readable = key ? Readable.from(BackupEncryptionUtilities.encrypt(data, key)) : data;
        const digest: BackupDigest = await this.stopOnShutdown(
            data,
            async () => await this.storeAndMeasure(stored, transports, backup, r)
        );
        // only now, and only if every transport took the whole thing. What `completed` is
        // for is telling a backup that finished from one that stopped halfway, which it can
        // only do if nothing sets it before the halfway point
        await this.backupResourceRepository.updateById(r.id, { ...digest, encryptedKey, completed: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restore(backup: BackupEntity): Promise<void> {
        // before anything else is believed about the record, because everything else a restore reads
        // out of it is read in the shape this names
        if (!READABLE_BACKUP_FORMAT_VERSIONS.includes(backup.formatVersion)) {
            throw new UnreadableBackupError(backup);
        }

        await TracingUtilities.trace('restore', { root: true }, async () => await this.restoreWithin(backup));
    }

    /**
     * Everything restoring a backup does, once the record has been found readable.
     * @param backup - The backup to restore.
     */
    private async restoreWithin(backup: BackupEntity): Promise<void> {
        this.isRestoringBackup.next(true);
        const staged: StagedResource[] = [];
        let keptSnapshotPaths: FsPath[] = [];
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
            for (const result of settled) {
                if (result.status === 'fulfilled' && result.value) {
                    staged.push(result.value);
                }
            }
            // nothing is applied yet, so a stop here has nothing to put back
            if (this.stopping.signal.aborted) {
                throw new RestoreStoppedError(backup);
            }
            const failure: PromiseRejectedResult | undefined = settled.find(r => r.status === 'rejected');
            if (failure) {
                throw failure.reason;
            }
            // what every resource holds right now, taken before any of them changes, so that one failing
            // to apply can be undone by putting the others back
            await Promise.all(staged.map(async s => {
                const current: Readable = await s.resource.createBackupData(backup);
                await this.stopOnShutdown(current, async () => await stage(current, s.snapshotPath));
            })).catch((error: unknown) => {
                throw this.stopping.signal.aborted ? new RestoreStoppedError(backup) : error;
            });
            await this.applyStaged(staged, backup, journalPath);
        }
        catch (error) {
            if (error instanceof RestoreNotUndoneError) {
                keptSnapshotPaths = error.snapshotPaths;
            }
            throw error;
        }
        finally {
            // only a killed process leaves its journal behind: anything else that ends a restore has
            // either finished it, put it back, or named what it could not put back
            await Promise.all([
                FsUtilities.rm(journalPath),
                ...staged.flatMap(s => [
                    FsUtilities.rm(s.path),
                    ...keptSnapshotPaths.includes(s.snapshotPath) ? [] : [FsUtilities.rm(s.snapshotPath)]
                ])
            ]);
            this.isRestoringBackup.next(false);
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
     * @throws What the failing resource threw, once the others are put back.
     * @throws {RestoreStoppedError} When the application stopped waiting, once the applied resources are put back.
     * @throws {RestoreNotUndoneError} When a resource could not be put back either.
     */
    private async applyStaged(staged: StagedResource[], backup: BackupEntity, journalPath: FsPath): Promise<void> {
        const applied: StagedResource[] = [];
        const journal: RestoreJournal = { backupName: backup.name, applied: [] };
        for (const s of staged) {
            // between two resources, the one place a restore can stop without leaving one of them half applied
            if (this.stopping.signal.aborted) {
                await this.putBack(applied, backup, new RestoreStoppedError(backup));
            }
            // noted before it is applied, so a process killed while applying it leaves it to be put back
            // at the next start
            journal.applied.push({ resourceName: s.entity.name, snapshotPath: s.snapshotPath });
            await RestoreJournalUtilities.write(journalPath, journal);
            try {
                await s.resource.restoreBackup(FsUtilities.createReadStream(s.path));
                applied.push(s);
            }
            catch (error) {
                // the failing one is put back too: nothing promises that a resource which throws has
                // applied none of its data, and putting back one that did is the same state again
                await this.putBack([...applied, s], backup, error);
            }
        }
    }

    /**
     * Puts the given resources back from their snapshots, the last one applied first, and fails with why.
     * @param touched - The resources to put back, in the order they were applied.
     * @param backup - The backup being restored.
     * @param error - Why the restore ended.
     * @throws The given error, once every resource is put back.
     * @throws {RestoreNotUndoneError} When a resource could not be put back.
     */
    private async putBack(touched: StagedResource[], backup: BackupEntity, error: unknown): Promise<never> {
        const notUndone: StagedResource[] = [];
        for (const t of [...touched].reverse()) {
            try {
                await t.resource.restoreBackup(FsUtilities.createReadStream(t.snapshotPath));
            }
            catch (undoError) {
                this.logger.error(new Error(
                    `Could not put back the resource "${t.entity.name}" after restoring backup "${backup.name}" failed.`,
                    { cause: undoError }
                ));
                notUndone.push(t);
            }
        }
        if (notUndone.length) {
            throw new RestoreNotUndoneError(backup, notUndone, error);
        }
        throw error;
    }

    /**
     * Fetches a resource's data to this instance's disk and checks it against what the backup recorded.
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
        const transports: BackupTransportInterface[] | undefined = this.resolveTransports(resource);
        if (!transports?.length) {
            this.logger.warn(
                `Problem while restoring backup "${backup.name}". Could not find transports for backup resource "${resource.name}"`
            );
            return;
        }
        // before anything is fetched, because a record saying the backup never finished is an answer
        // that costs nothing to reach - and reaching it afterwards is a download spent on saying no
        if (!resource.completed || resource.checksum == undefined || resource.size == undefined) {
            throw new IncompleteBackupError(backup, resource);
        }
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
        // is enough: nothing reaches the resource until every one of them has
        const p: FsPath = this.stagingPathFor(backup, resource);
        try {
            const data: Readable = await this.resolveData(transports, resource, backup);
            const digest: BackupDigest = await this.stopOnShutdown(data, async () => await stage(
                data,
                p,
                key ? source => BackupEncryptionUtilities.decrypt(source, key) : undefined
            ));
            if (digest.checksum !== resource.checksum || digest.size !== resource.size) {
                throw new CorruptBackupError(backup, resource, digest);
            }
        }
        catch (error) {
            await FsUtilities.rm(p);
            throw error;
        }
        return {
            entity: resource,
            resource: r,
            path: p,
            snapshotPath: FsUtilities.getPath(this.stagingFolder, `${backup.id}-${resource.id}-before`)
        };
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
        const transports: BackupTransportInterface[] = backup.resources.flatMap(r => this.resolveTransports(r) ?? []);
        // written here rather than by each transport, so that what a record is stays one thing said
        // in one place however many transports hold a copy of it
        const document: string = JsonUtilities.stringify(backup);
        await Promise.all([...new Set(transports)].map(async t => await t.storeMetadata(backup, document)));
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
            const staged: Promise<BackupDigest> = stage(data, p);
            const stored: Promise<void>[] = transports.map(
                async t => await t.storeData(Readable.from(followFile(p, staged)), backup, resource)
            );

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
        // resolved before anything is deleted, and refused rather than skipped: a resource whose transports
        // are unknown here would keep its data after the record pointing at it is gone, and nothing would
        // ever clean that up. Refused, the backup stays whole and can be deleted once they are known again
        const targets: [BackupResourceEntity, BackupTransportInterface[]][] = backup.resources.map(resource => {
            const transports: BackupTransportInterface[] | undefined = this.resolveTransports(resource);
            if (!transports?.length) {
                throw new InternalError(
                    `Could not delete the backup "${backup.name}": the transports of its resource "${resource.name}" are unknown.`
                );
            }
            return [resource, transports];
        });

        // the record first, the reverse of how a backup is stored: a delete that is interrupted leaves data
        // without a record, which is what an unfinished backup looks like, and the sync does not bring it back
        const transports: BackupTransportInterface[] = [...new Set(targets.flatMap(([, t]) => t))];
        await Promise.all(transports.map(async t => await t.deleteMetadata(backup)));
        await Promise.all(targets.flatMap(([resource, resourceTransports]) => {
            return resourceTransports.map(async t => await t.deleteData(backup, resource));
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRecordedBackups(): Promise<BackupEntity[]> {
        // an application that backs nothing up is not asked to declare the backup entities, so there
        // is no table to read
        if (!this.backupResources.length) {
            return [];
        }
        return await this.backupRepository.findAll({ limit: 'all' });
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

    private resolveTransportsFromMetadata(metadata: BackupResourceMetadata): BackupTransportInterface[] {
        if (metadata.transports === 'all') {
            return getRegisteredProvidersOfVariant(DiVariants.BACKUP_TRANSPORT)
                .map(t => inject(t.token))
                .filter(isBackupTransport);
        }

        return metadata.transports.map(t => inject(t));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveData(
        transports: BackupTransportInterface[],
        resource: BackupResourceEntity,
        backup: BackupEntity
    ): Promise<Readable> {
        for (const transport of transports) {
            try {
                const res: Readable = await transport.retrieveData(backup, resource);
                return res;
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
}