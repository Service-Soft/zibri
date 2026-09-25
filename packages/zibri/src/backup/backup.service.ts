import { Readable } from 'node:stream';

import { BehaviorSubject, first, firstValueFrom } from 'rxjs';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { READABLE_BACKUP_FORMAT_VERSIONS } from './backup-format';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BackupResourceInterface, isBackupResource } from './backup-resource.interface';
import { BackupCreateData, BackupServiceInterface } from './backup-service.interface';
import { BackupStagingCleanupCronJob } from './backup-staging-cleanup.cron-job';
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
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { parseObject } from '../parsing/functions/parse-object.function';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly isCreatingBackup: BehaviorSubject<boolean> = new BehaviorSubject(false);

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly isRestoringBackup: BehaviorSubject<boolean> = new BehaviorSubject(false);

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly shutdownTimeoutInMs: number = Ms.MINUTE * 15;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const backupResources: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.BACKUP_RESOURCE);
        if (backupResources.length) {
            if (!app.options.cronJobs.includes(BackupStagingCleanupCronJob)) {
                app.options.cronJobs.push(BackupStagingCleanupCronJob);
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
        await this.syncBackupEntities();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        await Promise.all([
            firstValueFrom(this.isCreatingBackup.pipe(first(v => !v))),
            firstValueFrom(this.isRestoringBackup.pipe(first(v => !v)))
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async syncBackupEntities(): Promise<void> {
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
        const existingEntities: BackupEntity[] = await this.backupRepository.findAll({ take: 'all' });
        const existingNames: string[] = existingEntities.map(e => e.name);
        const resolvedEntities: BackupEntity[] = (await Promise.all(allTransports.map(async t => {
            const documents: string[] = await t.resolveBackups(existingNames);
            return documents.map(d => this.toBackupEntity(d, t)).filter(e => e != undefined);
        }))).flat();
        const entitiesToSync: BackupEntity[] = resolvedEntities.filter(entity => !existingEntities.map(e => e.id).includes(entity.id));

        const groupedEntities: Record<string, BackupEntity[]> = this.groupEntitiesById(entitiesToSync);
        const mergedEntities: BackupEntity[] = this.mergeEntities(groupedEntities);
        await PromiseUtilities.allChunked(mergedEntities, e => this.backupRepository.create(e, { allowId: true }));
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
    async createBackup(data?: BackupCreateData): Promise<void> {
        // a trace of its own, for the reason a cron tick gets one: a backup is usually taken on a
        // schedule, and the one that is taken by hand is still not part of the request that asked
        // for it - it outlives the answer to that request
        await TracingUtilities.trace('createBackup', { root: true }, async () => await this.createBackupWithin(data));
    }

    /**
     * Everything taking a backup does.
     * @param data - What the backup was asked for with.
     */
    private async createBackupWithin(data?: BackupCreateData): Promise<void> {
        try {
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
            const createData: BackupEntityCreateData = {
                ...data,
                resources: resourceEntities
            };
            const backup: BackupEntity = await this.backupRepository.create(createData);

            this.isCreatingBackup.next(true);

            await Promise.all(backup.resources.map(async r => {
                const resource: BackupResourceInterface | undefined = this.resolveBackupResource(r);
                if (!resource) {
                    this.logger.warn(
                        `Problem while creating backup "${backup.name}". Could not find backup resource "${r.name}"`
                    );
                    return;
                }
                const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resource);
                if (!metadata) {
                    throw new BackupTransportNotFoundError(resource);
                }
                const transports: BackupTransportInterface[] = this.resolveTransportsFromMetadata(metadata);
                if (!transports.length) {
                    throw new BackupTransportNotFoundError(resource);
                }
                const data: Readable = await resource.createBackupData(backup);
                const digest: BackupDigest = await this.storeAndMeasure(data, transports, backup, r);
                // only now, and only if every transport took the whole thing. What `completed` is
                // for is telling a backup that finished from one that stopped halfway, which it can
                // only do if nothing sets it before the halfway point
                await this.backupResourceRepository.updateById(r.id, { ...digest, completed: true });
            }));

            await this.storeMetadata(backup.id);
        }
        finally {
            this.isCreatingBackup.next(false);
        }
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
        try {
            await Promise.all(backup.resources.map(async resource => this.restoreBackupResource(resource, backup)));
        }
        finally {
            this.isRestoringBackup.next(false);
        }
    }

    private async restoreBackupResource(resource: BackupResourceEntity, backup: BackupEntity): Promise<void> {
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

        // fetched to this instance's own disk, so the transport is read once however many passes the
        // check and the restore take between them. Checking while restoring would read it once too,
        // but could only say afterwards that what it had already applied was wrong - and a restore
        // recovering from a bad change has a current state worth not destroying over an archive that
        // turns out to be unusable
        const p: FsPath = this.stagingPathFor(backup, resource);
        await FsUtilities.mkdir(this.stagingFolder);
        try {
            const digest: BackupDigest = await stage(await this.resolveData(transports, resource, backup), p);
            if (digest.checksum !== resource.checksum || digest.size !== resource.size) {
                throw new CorruptBackupError(backup, resource, digest);
            }
            await r.restoreBackup(FsUtilities.createReadStream(p));
        }
        finally {
            await FsUtilities.rm(p);
        }
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
     * @param id - The backup that finished.
     */
    private async storeMetadata(id: string): Promise<void> {
        const backup: BackupEntity = await this.backupRepository.findById(id);
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
    resolveBackupResource(resource: BackupResourceEntity): BackupResourceInterface | undefined {
        return this.backupResources.find(r => r.constructor.name === resource.name);
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