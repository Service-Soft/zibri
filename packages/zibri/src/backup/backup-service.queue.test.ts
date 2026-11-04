import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-queue');

/**
 * How many of the next stores fail, as a transport whose server is down does.
 */
let storesToFail: number = 0;

/**
 * What every store waits for first, so a test can hold a backup back until it is ready for it to end.
 */
let storesHeldUntil: Promise<void> = Promise.resolve();

@BackupTransport()
class QueueFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'queue-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;

    override async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await storesHeldUntil;
        if (storesToFail > 0) {
            storesToFail--;
            data.destroy();
            throw new Error('the backup server could not be reached');
        }
        await super.storeData(data, backup, resource);
    }
}

@DataSource()
class QueueDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

@Backup({ transports: [QueueFsBackupTransport], encrypt: false })
class ProjectsStore implements BackupResourceInterface {
    createBackupData(): Readable {
        return Readable.from([Buffer.from('every project')]);
    }

    async restoreBackup(): Promise<void> {
        await Promise.resolve();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

let server: StartedTestServer | undefined;
let backupService: BackupServiceInterface;
let backups: Repository<BackupEntity, BackupEntityCreateData>;

beforeAll(async () => {
    // what an interrupted run left behind would be read back by the startup sync as backups of its own
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({
        dataSources: [QueueDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_RETRY_DELAY_IN_MS, useValue: 1 }),
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS, useValue: 2 })
        ]
    });
    backupService = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    backups = inject(repositoryTokenFor(BackupEntity));
}, TestTimeouts.inMemory.start);

beforeEach(() => {
    storesToFail = 0;
});

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Reads a backup with its resources.
 * @param id - The backup.
 * @returns The backup.
 */
async function findBackup(id: string): Promise<BackupEntity> {
    return await backups.findById(id, { relations: ['resources'] });
}

/**
 * Runs the queued backups once the first attempt at a backup's resource has failed, so that its retry
 * is due rather than its first attempt still running.
 * @param backup - The backup.
 */
async function runRetries(backup: BackupEntity): Promise<void> {
    await waitUntil(async () => (await findBackup(backup.id)).resources[0]?.error != undefined);
    // past the retry delay of a millisecond
    await sleep(20);
    await backupService.runQueuedBackups();
}

// a backup ran inside the call that asked for it, and one whose instance stopped halfway
// was abandoned, with nothing retrying a resource whose transport failed
describe('BackupService - a backup as queued work', () => {
    it('queues a backup and returns it running, and is told once every resource is stored', async () => {
        const queued: BackupEntity = await backupService.queueBackup({ name: 'queued' });
        expect(queued.status).toBe(BackupStatus.RUNNING);

        const done: BackupEntity = await backupService.waitForBackup(queued);

        expect(done.status).toBe(BackupStatus.COMPLETED);
        expect((await findBackup(queued.id)).resources.map(r => r.completed)).toEqual([true]);
        expect(await FsUtilities.exists(FsUtilities.getPath(backupFolder, 'queued', 'metadata.json'))).toBe(true);
    });

    it('tries a resource again once its transport failed, and completes the backup', async () => {
        storesToFail = 1;
        const queued: BackupEntity = await backupService.queueBackup({ name: 'retried' });
        const done: Promise<BackupEntity> = backupService.waitForBackup(queued);

        await runRetries(queued);

        expect((await done).status).toBe(BackupStatus.COMPLETED);
        const [resource] = (await findBackup(queued.id)).resources;
        expect(resource).toMatchObject({ completed: true, attempts: 2, error: null });
    });

    it('fails a backup whose resource spent its attempts, and says which', async () => {
        storesToFail = 2;
        const queued: BackupEntity = await backupService.queueBackup({ name: 'given-up' });
        const done: Promise<BackupEntity> = backupService.waitForBackup(queued);
        // what waiting answers once the backup failed, which it does before the test looks
        // eslint-disable-next-line promise/prefer-await-to-then
        done.catch(() => undefined);

        await runRetries(queued);

        await expect(done).rejects.toThrow(new RegExp(`given-up[\\S\\s]*${ProjectsStore.name}[\\S\\s]*could not be reached`));
        const failed: BackupEntity = await findBackup(queued.id);
        expect(failed.status).toBe(BackupStatus.FAILED);
        expect(failed.resources[0]?.error?.paragraphs.join('\n')).toContain('the backup server could not be reached');
    }, 20000);

    it('resumes a backup another instance left unfinished', async () => {
        // as an instance leaves it that stopped existing after the backup was queued
        const left: BackupEntity = await backups.create({
            name: 'left-unfinished',
            status: BackupStatus.RUNNING,
            masterKeys: [],
            dataKeyIds: [],
            resources: [{ name: 'ProjectsStore', transportNames: ['queue-fs-backup-transport'] }]
        });

        await backupService.runQueuedBackups();

        expect((await backupService.waitForBackup(left)).status).toBe(BackupStatus.COMPLETED);
    });

    // a backup that ended while its waiter was still subscribing told that waiter before its listener
    // existed, and the throw cut the end short: the other instances were never told it ended
    it('ends a backup normally while somebody waiting for it is still subscribing', async () => {
        const wakeUpService: WakeUpServiceInterface = inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
        const woken: jest.SpiedFunction<WakeUpServiceInterface['wake']> = jest.spyOn(wakeUpService, 'wake');
        const listen: WakeUpServiceInterface['listen'] = wakeUpService.listen.bind(wakeUpService);
        let releaseStores: () => void = () => undefined;
        storesHeldUntil = new Promise<void>(resolve => {
            releaseStores = resolve;
        });
        try {
            const queued: BackupEntity = await backupService.queueBackup({ name: 'ended-while-subscribing' });
            const announced: () => boolean = () => woken.mock.calls.some(([, topic]) => topic === WAKE_UP_TOPICS.backupEnded(queued.id));
            jest.spyOn(wakeUpService, 'listen').mockImplementationOnce(async (dataSource, topic, onWake) => {
                // the backup is stored and ends while the subscription is still on its way
                releaseStores();
                await waitUntil(announced).catch(() => undefined);
                return await listen(dataSource, topic, onWake);
            });

            const done: BackupEntity = await backupService.waitForBackup(queued);

            expect(done.status).toBe(BackupStatus.COMPLETED);
            expect(announced()).toBe(true);
        }
        finally {
            releaseStores();
            storesHeldUntil = Promise.resolve();
            woken.mockRestore();
        }
    }, 20000);
});