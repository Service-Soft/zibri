import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupChunkEntity } from './backup-chunk-entity.model';
import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from './backup-format';
import { BackupGarbageCollectionCronJob } from './backup-garbage-collection.cron-job';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { BackupLayoutTestUtilities } from '../__testing__/backup/backup-layout-test.utilities';
import { PlainChunk } from '../__testing__/backup/plain-chunk.model';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronServiceInterface } from '../cron/cron-service.interface';
import { CronService } from '../cron/cron.service';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { LeaseServiceInterface } from '../leases/lease-service.interface';
import { LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

const MIB: number = 1024 * 1024;

/**
 * Collecting the garbage of the backups, through the service, on a transport keeping files.
 * @param name - What the suite is named.
 * @param chunkIndexDeclared - Whether the data source declares `BackupChunkEntity`.
 * @param folderName - The folder of the transport, one per suite.
 */
export function describeBackupGarbageCollection(name: string, chunkIndexDeclared: boolean, folderName: string): void {
    const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, folderName);
    const transportName: string = 'garbage-fs-backup-transport';
    let projects: Buffer = Buffer.alloc(0);
    let restoredProjects: Buffer = Buffer.alloc(0);
    // while set, a backup of the tasks holds its resource until it resolves
    let tasksGate: Promise<void> | undefined;
    let tasksStarted: (() => void) | undefined;

    @BackupTransport()
    class GarbageFsBackupTransport extends FsBackupTransport {
        constructor() {
            super(transportName, backupFolder);
        }
    }

    @DataSource()
    class GarbageDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = [
            ...defaultTestServerEntities,
            BackupEntity,
            BackupResourceEntity,
            ...chunkIndexDeclared ? [BackupChunkEntity] : []
        ];
        override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    }

    @Backup({ transports: [GarbageFsBackupTransport], encrypt: false })
    class ProjectsStore implements BackupResourceInterface {
        createBackupData(): Readable {
            // in pieces, as a dump is read
            return Readable.from(Array.from(
                { length: Math.ceil(projects.length / 65_536) },
                (_, i) => projects.subarray(i * 65_536, (i + 1) * 65_536)
            ));
        }

        async restoreBackup(data: Readable): Promise<void> {
            restoredProjects = await buffer(data);
        }

        validateBackupConfiguration(): void {
            // holds everything it needs
        }
    }

    @Backup({ transports: [GarbageFsBackupTransport], encrypt: false })
    class TasksStore implements BackupResourceInterface {
        createBackupData(): Readable {
            return Readable.from(this.produce());
        }

        async restoreBackup(): Promise<void> {
            await Promise.resolve();
        }

        validateBackupConfiguration(): void {
            // holds everything it needs
        }

        private async* produce(): AsyncGenerator<Buffer> {
            tasksStarted?.();
            await tasksGate;
            yield Buffer.from('every task');
        }
    }

    let server: StartedTestServer | undefined;

    function getBackupService(): BackupServiceInterface {
        return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    }

    function getBackupRepository(): Repository<BackupEntity, BackupEntityCreateData> {
        return inject(repositoryTokenFor(BackupEntity));
    }

    /**
     * Takes a backup, and waits until the pass that stored it is over.
     * @param backupName - The name of the backup.
     * @returns The backup, completed.
     */
    async function takeBackup(backupName: string): Promise<BackupEntity> {
        const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: backupName }));
        await firstValueFrom(getBackupService().isCreatingBackup.pipe(first(creating => !creating)));
        return backup;
    }

    async function collectGarbage(): Promise<void> {
        const backupService: BackupServiceInterface = getBackupService();
        assert(backupService.collectGarbage, 'the backup service collects no garbage');
        await backupService.collectGarbage();
    }

    function getProjects(backup: BackupEntity): BackupResourceEntity {
        const resource: BackupResourceEntity | undefined = backup.resources.find(r => r.name === ProjectsStore.name);
        assert(resource, `the backup "${backup.name}" holds no projects`);
        return resource;
    }

    /**
     * The chunks the given backups name, or every backup of format 2 the database records.
     * @param backups - The backups, with their resources.
     * @returns The files of the chunks, sorted.
     */
    async function resolveNamedChunks(backups?: BackupEntity[]): Promise<FsPath[]> {
        const named: BackupEntity[] = backups ?? (await getBackupRepository().findAll({ relations: ['resources'], limit: 'all' }))
            .filter(backup => backup.formatVersion >= 2);
        const paths: FsPath[][] = await Promise.all(named.flatMap(backup => backup.resources.map(async resource => {
            return await BackupLayoutTestUtilities.resolvePlainChunkPaths(backupFolder, backup, resource);
        })));
        return [...new Set(paths.flat())].sort();
    }

    async function findChunkPaths(): Promise<FsPath[]> {
        return (await BackupLayoutTestUtilities.findChunkPaths(backupFolder)).sort();
    }

    async function restore(backup: BackupEntity): Promise<void> {
        restoredProjects = Buffer.alloc(0);
        await getBackupService().restore(await getBackupRepository().findById(backup.id, { relations: ['resources'] }));
    }

    describe(name, () => {
        beforeAll(async () => {
            await FsUtilities.rm(backupFolder);
            server = await startTestServer({
                dataSources: [GarbageDataSource],
                providers: [
                    // the real cron service rather than the stub that registers nothing: that the application
                    // registers the job is part of what is tested
                    ...defaultTestServerProviders.filter(provider => provider.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService }),
                    // small, so that a few MiB of data make dozens of chunks
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS,
                        useValue: { minChunkBytes: 16 * 1024, averageChunkBytes: 64 * 1024, maxChunkBytes: 256 * 1024, compressionLevel: 3 }
                    }),
                    // every chunk on every collection
                    defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS, useValue: { cycleInDays: 1 } })
                ]
            });
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
            await FsUtilities.rm(backupFolder);
        }, TestTimeouts.inMemory.shutdown);

        it('is collected once a day, registered for you', () => {
            const cronService: CronServiceInterface = inject(ZIBRI_DI_TOKENS.CRON_SERVICE);
            expect(cronService.cronJobs.some(job => job instanceof BackupGarbageCollectionCronJob)).toBe(true);
        });

        it('deletes the chunks only deleted backups named, and the backups kept still restore', async () => {
            projects = randomBytes(2 * MIB);
            const deleted: BackupEntity = await takeBackup('deleted');
            // half of it changed, so that the backups share the other half
            projects = Buffer.concat([projects.subarray(0, MIB), randomBytes(MIB)]);
            const kept: BackupEntity = await takeBackup('kept');
            const deletedChunks: FsPath[] = await resolveNamedChunks([deleted]);
            const keptChunks: FsPath[] = await resolveNamedChunks([kept]);
            const freed: FsPath[] = deletedChunks.filter(p => !keptChunks.includes(p));
            // neither side vacuous: chunks only the deleted backup named, and chunks both name
            expect(freed.length).toBeGreaterThan(0);
            expect(keptChunks.some(p => deletedChunks.includes(p))).toBe(true);

            await getBackupService().delete(deleted);
            expect(await findChunkPaths()).toEqual(expect.arrayContaining(freed));
            // as the day's collection runs it
            await inject(BackupGarbageCollectionCronJob).onTick();

            expect(await findChunkPaths()).toEqual(await resolveNamedChunks());
            await restore(kept);
            expect(restoredProjects.equals(projects)).toBe(true);
        }, 30000);

        it('deletes what backups that never finished stored: failed, or unknown to the database', async () => {
            projects = randomBytes(MIB);
            const failed: BackupEntity = await takeBackup('failed-part-way');
            projects = randomBytes(MIB);
            const unknown: BackupEntity = await takeBackup('lost-to-the-database');
            // as what a backup left that failed after storing some of its resources, and one an instance
            // stored before the database it was recorded in was replaced
            await FsUtilities.rm(BackupLayoutTestUtilities.resolveRecordPath(backupFolder, failed));
            await getBackupRepository().updateById(failed.id, { status: BackupStatus.FAILED });
            await FsUtilities.rm(BackupLayoutTestUtilities.resolveRecordPath(backupFolder, unknown));
            await inject(repositoryTokenFor(BackupResourceEntity)).deleteAll({ backupId: unknown.id });
            await getBackupRepository().deleteById(unknown.id);

            await collectGarbage();

            expect(await FsUtilities.exists(BackupLayoutTestUtilities.resolveBackupFolder(backupFolder, failed))).toBe(false);
            expect(await FsUtilities.exists(BackupLayoutTestUtilities.resolveBackupFolder(backupFolder, unknown))).toBe(false);
            // the failed backup is recorded no more on the transport, so it names no chunk either
            await getBackupRepository().deleteById(failed.id);
            expect(await findChunkPaths()).toEqual(await resolveNamedChunks());
        }, 30000);

        it('waits while a resource is stored, and keeps every chunk the backup storing it names', async () => {
            projects = randomBytes(MIB);
            await getBackupService().delete(await takeBackup('garbage-to-collect'));
            projects = randomBytes(MIB);
            let open: () => void = () => undefined;
            tasksGate = new Promise(resolve => open = resolve);
            const started: Promise<void> = new Promise(resolve => tasksStarted = resolve);
            const queued: BackupEntity = await getBackupService().queueBackup({ name: 'while-collecting' });
            await started;

            let collected: boolean = false;
            const collecting: Promise<void> = (async () => {
                await collectGarbage();
                collected = true;
            })();
            await setTimeout(1000);
            expect(collected).toBe(false);
            open();
            const done: BackupEntity = await getBackupService().waitForBackup(queued);
            await collecting;
            tasksGate = undefined;
            tasksStarted = undefined;

            expect(done.resources.map(r => r.name)).toContain(TasksStore.name);
            expect(await findChunkPaths()).toEqual(await resolveNamedChunks());
            await restore(done);
            expect(restoredProjects.equals(projects)).toBe(true);
        }, 30000);

        it('forgets a chunk that went missing, reports the backup naming it, and the next backup stores it again', async () => {
            projects = randomBytes(MIB);
            const damaged: BackupEntity = await takeBackup('lost-a-chunk');
            const chunk: PlainChunk = await BackupLayoutTestUtilities.resolveFirstPlainChunk(backupFolder, damaged, getProjects(damaged));
            await FsUtilities.rm(chunk.path);
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const errorSpy: jest.SpiedFunction<LoggerInterface['error']> = jest.spyOn(logger, 'error');

            try {
                await collectGarbage();

                expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
                    message: expect.stringContaining('of the backup "lost-a-chunk" cannot be restored from the backup transport')
                }));
            }
            finally {
                errorSpy.mockRestore();
            }
            if (chunkIndexDeclared) {
                const rows: BackupChunkEntity[] = await inject(repositoryTokenFor(BackupChunkEntity)).findAll({ limit: 'all' });
                expect(rows.filter(row => row.key.endsWith(chunk.id))).toEqual([]);
            }
            const again: BackupEntity = await takeBackup('stores-it-again');
            expect(await FsUtilities.exists(chunk.path)).toBe(true);
            await restore(again);
            expect(restoredProjects.equals(projects)).toBe(true);
        }, 30000);

        it('deletes a chunk that changed where it is stored, reports the backup naming it, '
            + 'and the next backup stores it again', async () => {
            projects = randomBytes(MIB);
            const altered: BackupEntity = await takeBackup('altered');
            const chunk: PlainChunk = await BackupLayoutTestUtilities.resolveFirstPlainChunk(backupFolder, altered, getProjects(altered));
            const bytes: Buffer = await readFile(chunk.path);
            bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
            await writeFile(chunk.path, bytes);
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const errorSpy: jest.SpiedFunction<LoggerInterface['error']> = jest.spyOn(logger, 'error');

            try {
                await collectGarbage();

                expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
                    message: expect.stringContaining('of the backup "altered" cannot be restored from the backup transport')
                }));
            }
            finally {
                errorSpy.mockRestore();
            }
            expect(await FsUtilities.exists(chunk.path)).toBe(false);
            const again: BackupEntity = await takeBackup('after-altered');
            expect(await FsUtilities.exists(chunk.path)).toBe(true);
            await restore(again);
            expect(restoredProjects.equals(projects)).toBe(true);
        }, 30000);

        it('lets a resource waiting to be stored in between two windows of a sweep', async () => {
            // more garbage than one window deletes
            const garbageFolder: FsPath = FsUtilities.getPath(backupFolder, BACKUP_REPOSITORY_FOLDER, 'chunks', '00');
            await FsUtilities.mkdir(garbageFolder);
            await Promise.all(Array.from({ length: 1001 }, async () => {
                await writeFile(FsUtilities.getPath(garbageFolder, `00${randomBytes(31).toString('hex')}`), randomBytes(64));
            }));
            const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
            const storingKey: string = `backup:storing:${ProjectsStore.name}`;
            const withLeases: LeaseServiceInterface['withLeases'] = leaseService.withLeases.bind(leaseService);
            const events: ('window' | 'stored')[] = [];
            let waiting: Promise<void | undefined> | undefined;
            const spy: jest.SpiedFunction<LeaseServiceInterface['withLeases']> = jest.spyOn(leaseService, 'withLeases')
                .mockImplementation(async (keys, options, fn) => await withLeases(keys, options, async (taken, lost) => {
                    if (taken.includes(storingKey)) {
                        events.push('window');
                        // queued while the window holds the resource, as a backup of it is
                        waiting ??= leaseService.withLease(
                            { key: storingKey, leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.MINUTE },
                            async () => {
                                events.push('stored');
                                await Promise.resolve();
                            }
                        );
                    }
                    return await fn(taken, lost);
                }));

            try {
                await collectGarbage();
                await waiting;
            }
            finally {
                spy.mockRestore();
            }
            expect(events.slice(0, 3)).toStrictEqual(['window', 'stored', 'window']);
        }, 30000);

        it('keeps a chunk in a shape a newer build writes, and warns that it could not check it', async () => {
            projects = randomBytes(MIB);
            const newer: BackupEntity = await takeBackup('newer');
            const chunk: PlainChunk = await BackupLayoutTestUtilities.resolveFirstPlainChunk(backupFolder, newer, getProjects(newer));
            const bytes: Buffer = await readFile(chunk.path);
            // a format past the one this build writes, as the first byte says
            bytes[0] = (bytes[0] ?? 0) + 1;
            await writeFile(chunk.path, bytes);
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const warnSpy: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');

            try {
                await collectGarbage();

                expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is written by a newer build'));
            }
            finally {
                warnSpy.mockRestore();
            }
            expect(await FsUtilities.exists(chunk.path)).toBe(true);
        }, 30000);

        it('leaves a backup of format 1 in the same transport as it is', async () => {
            projects = randomBytes(MIB);
            // as a build reading only format 1 queued it, before an instance of this one stored its resources
            const queued: BackupEntity = await getBackupRepository().create({
                name: 'format-1',
                status: BackupStatus.RUNNING,
                masterKeys: [],
                dataKeyIds: [],
                resources: [{ name: ProjectsStore.name, transportNames: [transportName] }]
            });
            await getBackupRepository().updateById(queued.id, { formatVersion: 1 });
            await getBackupService().runQueuedBackups();
            const done: BackupEntity = await getBackupService().waitForBackup(queued);

            await collectGarbage();

            expect(await FsUtilities.exists(FsUtilities.getPath(backupFolder, 'format-1', ProjectsStore.name))).toBe(true);
            expect(await findChunkPaths()).toEqual(await resolveNamedChunks());
            await restore(done);
            expect(restoredProjects.equals(projects)).toBe(true);
        }, 30000);
    });
}