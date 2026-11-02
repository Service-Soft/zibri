/* eslint-disable unicorn/no-null */
import assert from 'node:assert';
import { Dirent } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-shutdown');

@BackupTransport()
class ShutdownFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'shutdown-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
class ShutdownDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * How the data of the next backup arrives: all at once, after the given time, or never.
 */
type DataArrival = 'at once' | number | 'never';

/**
 * How many restores of the second resource fail, counted across restarts, because a restart builds
 * the resource anew.
 */
let secondRestoresToFail: number = 0;

/**
 * A resource holding one value, whose backup can be made slow and whose restore can be held up.
 */
abstract class ValueStore implements BackupResourceInterface {
    value: string = '';

    dataArrival: DataArrival = 'at once';

    /**
     * Run once, before the next restore applies anything.
     */
    beforeNextApply: (() => Promise<void>) | undefined;

    /**
     * Run once, after the next restore applied its data.
     */
    afterNextApply: (() => Promise<void>) | undefined;

    createBackupData(): Readable {
        const arrival: DataArrival = this.dataArrival;
        if (arrival === 'at once') {
            return Readable.from([Buffer.from(this.value)]);
        }
        // a stream of its own rather than a generator: a generator waiting for a chunk that is never
        // coming cannot be ended, so stopping the backup would wait on it
        const data: Readable = new Readable({ read: () => undefined });
        data.push(Buffer.from(this.value));
        if (arrival !== 'never') {
            setTimeout(() => data.push(null), arrival);
        }
        return data;
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const before: (() => Promise<void>) | undefined = this.beforeNextApply;
        this.beforeNextApply = undefined;
        await before?.();
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        if (this instanceof SecondStore && secondRestoresToFail > 0) {
            secondRestoresToFail--;
            throw new Error('the second store could not be applied');
        }
        this.value = Buffer.concat(chunks).toString();
        const after: (() => Promise<void>) | undefined = this.afterNextApply;
        this.afterNextApply = undefined;
        await after?.();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

// declared first, so it is the first resource a restore applies
@Backup({ transports: [ShutdownFsBackupTransport], encrypt: false })
class FirstStore extends ValueStore {}

@Backup({ transports: [ShutdownFsBackupTransport], encrypt: false })
class SecondStore extends ValueStore {}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

/**
 * Starts a server that waits the given time for a running backup or restore when it stops.
 * @param shutdownWaitInMs - How long it waits, or undefined for the default.
 * @param stoppingTimeoutInMs - How long stopping it may take then, or undefined for the default.
 * @returns The server.
 */
async function startServer(shutdownWaitInMs?: number, stoppingTimeoutInMs?: number): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [ShutdownDataSource],
        providers: [
            ...defaultTestServerProviders,
            ...shutdownWaitInMs == undefined
                ? []
                : [defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS, useValue: shutdownWaitInMs })],
            ...stoppingTimeoutInMs == undefined
                ? []
                : [defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_STOPPING_TIMEOUT_IN_MS, useValue: stoppingTimeoutInMs })]
        ]
    });
}

/**
 * Takes a backup of both stores holding "backed up", then sets both to "current".
 * @param name - The name of the backup.
 * @returns The backup, with its resources.
 */
async function createBackedUpState(name: string): Promise<BackupEntity> {
    inject(FirstStore).value = 'backed up';
    inject(SecondStore).value = 'backed up';
    const service: BackupServiceInterface = getBackupService();
    await service.waitForBackup(await service.queueBackup({ name }));
    const [backup]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({
        where: { name },
        relations: ['resources']
    });
    assert(backup, 'the backup was not created');
    inject(FirstStore).value = 'current';
    inject(SecondStore).value = 'current';
    return backup;
}

/**
 * A backup that is running.
 */
type RunningBackup = {
    /**
     * The backup as it was queued.
     */
    backup: BackupEntity,
    /**
     * What waiting for it ends with: the backup once it completed, or the error waiting stopped with.
     */
    ended: Promise<unknown>
};

/**
 * Starts a backup and resolves once its data is on its way.
 * @param name - The name of the backup.
 * @returns The running backup.
 */
async function startBackup(name: string): Promise<RunningBackup> {
    const service: BackupServiceInterface = getBackupService();
    const backup: BackupEntity = await service.queueBackup({ name });
    // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
    const ended: Promise<unknown> = service.waitForBackup(backup).catch((error: unknown) => error);
    await firstValueFrom(service.isCreatingBackup.pipe(first(v => v)));
    // long enough for the first chunk to reach the transport
    await sleep(200);
    return { backup, ended };
}

/**
 * Reads a backup with its resources.
 * @param id - The backup.
 * @returns The backup.
 */
async function findBackup(id: string): Promise<BackupEntity> {
    return await inject(repositoryTokenFor(BackupEntity)).findById(id, { relations: ['resources'] });
}

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
});

// a backup stopped by a shutdown was deleted, and one whose instance died was abandoned
describe('BackupService — a backup when the application stops', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        await FsUtilities.rm(backupFolder);
    }, 60000);

    it('hands a running backup over at once by default, without counting the attempt it stopped', async () => {
        server = await startServer();
        inject(FirstStore).dataArrival = 'never';
        const running: RunningBackup = await startBackup('handed-over');

        const startedAt: number = Date.now();
        // a restart, which keeps what the data source holds
        await server.reInit();

        expect(Date.now() - startedAt).toBeLessThan(Ms.SECOND * 10);
        const error: unknown = await running.ended;
        assert(error instanceof Error, 'waiting for the backup did not stop');
        expect(error.message).toContain('Another instance stores what is left of it');
        const handedOver: BackupEntity = await findBackup(running.backup.id);
        expect(handedOver.status).toBe(BackupStatus.RUNNING);
        expect(handedOver.resources.map(r => [r.completed, r.attempts])).toContainEqual([false, 0]);

        // the instance that carries on, with a store whose data arrives
        await getBackupService().runQueuedBackups();
        expect((await getBackupService().waitForBackup(handedOver)).status).toBe(BackupStatus.COMPLETED);
    }, TestTimeouts.inMemory.start);

    it('lets a running backup finish within BACKUP_SHUTDOWN_WAIT_IN_MS', async () => {
        server = await startServer(Ms.SECOND * 10);
        inject(FirstStore).dataArrival = Ms.SECOND;
        const running: RunningBackup = await startBackup('waited-for');

        await server.shutdown();
        server = undefined;

        expect(await running.ended).toMatchObject({ status: BackupStatus.COMPLETED });
        expect(await FsUtilities.exists(FsUtilities.getPath(backupFolder, 'waited-for', 'metadata.json'))).toBe(true);
    }, TestTimeouts.inMemory.start);

    it('hands a running backup over once BACKUP_SHUTDOWN_WAIT_IN_MS is over', async () => {
        server = await startServer(Ms.SECOND / 2);
        inject(FirstStore).dataArrival = 'never';
        const running: RunningBackup = await startBackup('waited-for-in-vain');

        const startedAt: number = Date.now();
        await server.reInit();

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(Ms.SECOND / 2);
        expect(Date.now() - startedAt).toBeLessThan(Ms.SECOND * 10);
        expect(await running.ended).toBeInstanceOf(Error);
        expect((await findBackup(running.backup.id)).status).toBe(BackupStatus.RUNNING);
    }, TestTimeouts.inMemory.start);

    // stopping was given 30 seconds, whatever putting
    // back what a large restore applied takes
    it('is given BACKUP_SHUTDOWN_WAIT_IN_MS and then BACKUP_STOPPING_TIMEOUT_IN_MS when the application stops', async () => {
        server = await startServer(Ms.SECOND, Ms.MINUTE * 5);
        // what the application reads off the service's shutdown hook, which the interface leaves out
        const service: BackupServiceInterface & Pick<AfterAppShutdown, 'shutdownTimeoutInMs'> = getBackupService();

        expect(service.shutdownTimeoutInMs).toBe(Ms.SECOND + (Ms.MINUTE * 5));
    }, TestTimeouts.inMemory.start);
});

describe('BackupService — a restore when the application stops', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        secondRestoresToFail = 0;
        await FsUtilities.rm(backupFolder);
    }, 60000);

    it('stops before the next resource, and puts back what it applied', async () => {
        server = await startServer();
        const backup: BackupEntity = await createBackedUpState('stopped-restore');
        const firstStore: FirstStore = inject(FirstStore);
        const secondStore: SecondStore = inject(SecondStore);
        let firstApplied!: () => void;
        const applied: Promise<void> = new Promise(resolve => firstApplied = resolve);
        // still applying the first resource while the application is told to stop
        firstStore.afterNextApply = async () => {
            firstApplied();
            await sleep(500);
        };

        // eslint-disable-next-line stylistic/newline-per-chained-call, promise/prefer-await-to-callbacks, promise/prefer-await-to-then
        const restored: Promise<unknown> = getBackupService().restore(backup).catch((error: unknown) => error);
        await applied;
        await server.shutdown();
        server = undefined;

        const error: unknown = await restored;
        assert(error instanceof Error, 'the restore did not fail');
        expect(error.message).toContain('The restore of backup "stopped-restore" was stopped because the application is shutting down');
        expect(firstStore.value).toBe('current');
        expect(secondStore.value).toBe('current');
    }, TestTimeouts.inMemory.start);
});

describe('BackupService — a restore the process was killed in', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        secondRestoresToFail = 0;
        await FsUtilities.rm(backupFolder);
    }, 60000);

    /**
     * Leaves the staging folder the way a process killed while restoring the second resource leaves it.
     *
     * A process cannot be killed inside a test, so the restore is held while the second resource
     * applies, the staging folder is copied, and the copy is put back once the restore has ended.
     * @param name - The name of the backup being restored.
     * @returns The staging folder.
     */
    async function leaveRestoreKilledWhileApplyingTheSecondResource(name: string): Promise<FsPath> {
        const stagingFolder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
        const copy: FsPath = FsUtilities.getPath(testFileFolder, 'backups-shutdown-killed-staging');
        const backup: BackupEntity = await createBackedUpState(name);
        let secondApplying!: () => void;
        const applying: Promise<void> = new Promise(resolve => secondApplying = resolve);
        let release!: () => void;
        const released: Promise<void> = new Promise(resolve => release = resolve);
        inject(SecondStore).beforeNextApply = async () => {
            secondApplying();
            await released;
            throw new Error('killed');
        };

        // eslint-disable-next-line stylistic/newline-per-chained-call, promise/prefer-await-to-callbacks, promise/prefer-await-to-then
        const restored: Promise<unknown> = getBackupService().restore(backup).catch((error: unknown) => error);
        await applying;
        await FsUtilities.rm(copy);
        await copyFiles(stagingFolder, copy);
        release();
        expect(await restored).toEqual(new Error('killed'));

        // what the kill would have left: the first resource applied, the second one untouched
        inject(FirstStore).value = 'backed up';
        await copyFiles(copy, stagingFolder);
        await FsUtilities.rm(copy);
        return stagingFolder;
    }

    /**
     * Copies the files of one folder into another.
     * @param from - The folder to copy from, which holds files only.
     * @param to - The folder to copy into.
     */
    async function copyFiles(from: FsPath, to: FsPath): Promise<void> {
        await FsUtilities.mkdir(to);
        const files: Dirent[] = await FsUtilities.readdir(from);
        await Promise.all(files.map(async f => await copyFile(FsUtilities.getPath(from, f.name), FsUtilities.getPath(to, f.name))));
    }

    it('puts back what it applied when the application starts again', async () => {
        server = await startServer();
        const stagingFolder: FsPath = await leaveRestoreKilledWhileApplyingTheSecondResource('killed-restore');

        await server.reInit();

        // a restart builds the stores anew, so a value is only there when the restart put it back
        expect(inject(FirstStore).value).toBe('current');
        expect(inject(SecondStore).value).toBe('current');
        expect(await FsUtilities.glob(FsUtilities.getPath(stagingFolder, '*.restore-journal.json'))).toEqual([]);
    }, 60000);

    it('keeps what it could not put back for the next start, and puts back the rest', async () => {
        server = await startServer();
        const stagingFolder: FsPath = await leaveRestoreKilledWhileApplyingTheSecondResource('killed-restore-not-put-back');
        secondRestoresToFail = 1;

        await server.reInit();

        expect(inject(FirstStore).value).toBe('current');
        expect(inject(SecondStore).value).toBe('');
        expect(await FsUtilities.glob(FsUtilities.getPath(stagingFolder, '*.restore-journal.json'))).toHaveLength(1);

        await server.reInit();

        expect(inject(SecondStore).value).toBe('current');
        expect(await FsUtilities.glob(FsUtilities.getPath(stagingFolder, '*.restore-journal.json'))).toEqual([]);
    }, 60000);

    // a snapshot was put back as it was found, and one a host
    // going down left short is the resource's data with the end missing
    it('puts back no snapshot that is not what the restore wrote, and keeps it for the next start', async () => {
        server = await startServer();
        const stagingFolder: FsPath = await leaveRestoreKilledWhileApplyingTheSecondResource('killed-restore-short-snapshot');
        const [journalPath] = await RestoreJournalUtilities.findPaths(stagingFolder);
        assert(journalPath, 'the restore left no journal');
        const firstSnapshot: FsPath | undefined = (await RestoreJournalUtilities.resolve(journalPath)).applied
            .find(e => e.resourceName === FirstStore.name)?.snapshotPath;
        assert(firstSnapshot, 'the journal names no snapshot of the first store');
        // what a host that went down before the file reached the disk leaves: the file, cut short
        await FsUtilities.upsertFile(firstSnapshot, 'curr');

        await server.reInit();

        expect(inject(FirstStore).value).toBe('');
        expect(inject(SecondStore).value).toBe('current');
        expect(await FsUtilities.glob(FsUtilities.getPath(stagingFolder, '*.restore-journal.json'))).toEqual([journalPath]);
    }, 60000);
});