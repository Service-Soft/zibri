import { Readable } from 'node:stream';

import { BehaviorSubject, first, firstValueFrom } from 'rxjs';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupCreateData, BackupServiceInterface } from './backup-service.interface';
import { ZibriApplication } from '../application';
import { PostgresDataSource } from '../data-source/data-sources/postgres-typeorm-data-source.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { BackupResourceMetadata } from './decorators/backup-resource-metadata.model';
import { BackupTransportInterface } from './transports/backup-transport.interface';
import { Repository } from '../data-source/repository';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';

/**
 * Default implementation of the backup service.
 */
@Injectable({ register: 'onUse' })
export class BackupService implements BackupServiceInterface, OnAppInit, OnAppShutdown {
    private readonly backupResources: Newable<BackupResourceInterface>[] = [];

    private get backupRepository(): Repository<BackupEntity, BackupEntityCreateData> {
        return inject(repositoryTokenFor(BackupEntity));
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
        if (GlobalRegistry.backupResources.length) {
            // eslint-disable-next-line stylistic/max-len
            await this.logger.info(`configures ${GlobalRegistry.backupResources.length} ${GlobalRegistry.backupResources.length > 1 ? 'resources' : 'resource'} to be backed up:`);
            validateEntitiesRegistered(BackupService.name, app, BackupResourceEntity, BackupEntity);
        }

        for (const resourceClass of GlobalRegistry.backupResources) {
            this.backupResources.push(resourceClass);
            const resource: BackupResourceInterface = inject(resourceClass);
            if (resource.createBackupData == undefined || resource.restoreBackup == undefined) {
                throw new Error(`Invalid resource marked with @Backup: ${resourceClass.name} needs to implement BackupResourceInterface`);
            }
            if (resource instanceof PostgresDataSource && (!resource.rootPw || !resource.rootUsername)) {
                throw new Error(`Invalid data source marked with @Backup: ${resourceClass.name} needs to provide rootPw and rootUsername`);
            }
            if (!MetadataUtilities.getBackupResourceMetadata(resourceClass)?.transports.length) {
                throw new Error('Needs to have at least one transport defined');
            }
            await this.logger.info(`  - ${resourceClass.name}`);
        }

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
        const transports: BackupTransportInterface[] = this.backupResources
            .map(r => MetadataUtilities.getBackupResourceMetadata(r)?.transports ?? [])
            .flat();
        if (!transports.length) {
            await this.logger.warn('Could not find any transports to sync backup entities from');
            return;
        }
        const existingEntities: BackupEntity[] = await this.backupRepository.findAll();
        const resolvedEntities: BackupEntity[] = (await Promise.all(transports.map(t => t.resolveBackups(existingEntities)))).flat();
        const entitiesToSync: BackupEntity[] = resolvedEntities.filter(entity => !existingEntities.map(e => e.id).includes(entity.id));

        const groupedEntities: Record<string, BackupEntity[]> = this.groupEntitiesById(entitiesToSync);
        const mergedEntities: BackupEntity[] = this.mergeEntities(groupedEntities);
        await PromiseUtilities.allChunked(mergedEntities, e => this.backupRepository.create(e, { allowId: true }));
    }

    private mergeEntities(groupedEntities: Record<string, BackupEntity[]>): BackupEntity[] {
        const res: BackupEntity[] = [];
        for (const key in groupedEntities) {
            const entities: BackupEntity[] = groupedEntities[key];
            res.push({
                createdAt: entities[0].createdAt,
                id: entities[0].id,
                name: entities[0].name,
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
            if (res[entity.id] == undefined) {
                res[entity.id] = [entity];
            }
            else {
                res[entity.id].push(entity);
            }
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createBackup(data?: BackupCreateData): Promise<void> {
        try {
            const resourceEntities: BackupResourceEntityCreateData[] = [];
            for (const backupResource of this.backupResources) {
                const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(backupResource);
                const transports: BackupTransportInterface[] | undefined = metadata?.transports;
                if (!transports?.length) {
                    throw new Error(`Could not find a transport for the backup resource "${backupResource.name}"`);
                }
                resourceEntities.push({ name: metadata?.name ?? backupResource.name, transportNames: transports.map(t => t.name) });
            }
            const createData: BackupEntityCreateData = {
                ...data,
                resources: resourceEntities
            };
            const backup: BackupEntity = await this.backupRepository.create(createData);

            this.isCreatingBackup.next(true);

            await Promise.all(backup.resources.map(async r => {
                const resource: Newable<BackupResourceInterface> | undefined = this.resolveBackupResource(r);
                if (!resource) {
                    await this.logger.warn(
                        `Problem while creating backup "${backup.name}". Could not find backup resource "${r.name}"`
                    );
                    return;
                }
                const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resource);
                const transports: BackupTransportInterface[] | undefined = metadata?.transports;
                if (!transports?.length) {
                    throw new Error(`Could not find a transport for the backup resource "${resource.name}"`);
                }
                const data: Readable = await inject(resource).createBackupData(backup);
                await Promise.all(transports.map(t => t.storeData(data, backup, r)));
            }));
        }
        finally {
            this.isCreatingBackup.next(false);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restore(backup: BackupEntity): Promise<void> {
        this.isRestoringBackup.next(true);
        try {
            await Promise.all(backup.resources.map(async resource => this.restoreBackupResource(resource, backup)));
        }
        finally {
            this.isRestoringBackup.next(false);
        }
    }

    private async restoreBackupResource(resource: BackupResourceEntity, backup: BackupEntity): Promise<void> {
        const resourceClass: Newable<BackupResourceInterface> | undefined = this.resolveBackupResource(resource);
        if (!resourceClass) {
            await this.logger.warn(
                `Problem while restoring backup "${backup.name}". Could not find backup resource "${resource.name}"`
            );
            return;
        }
        const transports: BackupTransportInterface[] | undefined = this.resolveTransports(resource);
        if (!transports?.length) {
            await this.logger.warn(
                `Problem while restoring backup "${backup.name}". Could not find transports for backup resource "${resource.name}"`
            );
            return;
        }
        const data: Readable = await this.resolveData(transports, resource, backup);
        const r: BackupResourceInterface = inject(resourceClass);
        await r.restoreBackup(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(backup: BackupEntity): Promise<void> {
        await Promise.all(backup.resources.map(async resource => {
            const resourceClass: Newable<BackupResourceInterface> | undefined = this.resolveBackupResource(resource);
            if (!resourceClass) {
                await this.logger.warn(
                    `Problem while restoring backup "${backup.name}". Could not find backup resource "${resource.name}"`
                );
                return;
            }
            const transports: BackupTransportInterface[] | undefined = this.resolveTransports(resource);
            if (!transports?.length) {
                await this.logger.warn(
                    `Problem while deleting backup "${backup.name}". Could not find transports for backup resource "${resource.name}"`
                );
                return;
            }
            await Promise.all(transports.map(async t => {
                await t.deleteData(backup, resource);
            }));
        }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveBackupResource(resource: BackupResourceEntity): Newable<BackupResourceInterface> | undefined {
        return this.backupResources.find(r => r.name === resource.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTransports(resource: BackupResourceEntity): BackupTransportInterface[] | undefined {
        const resourceClass: Newable<BackupResourceInterface> | undefined = this.resolveBackupResource(resource);
        if (!resourceClass) {
            return;
        }
        const metadata: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(resourceClass);
        return metadata?.transports;
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
                await this.logger.warn(
                    [
                        `Could not resolve backup data for resource "${resource.name}" from transport: ${transport.name}.`,
                        'Cause:',
                        error instanceof Error ? error.message : JsonUtilities.stringify(error)
                    ].join('\n')
                );
            }
        }

        throw new Error(`Could not resolve backup data for resource "${resource.name}".`);
    }
}