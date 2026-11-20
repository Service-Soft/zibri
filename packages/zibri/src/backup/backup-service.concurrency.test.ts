import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupTransportSessionTestUtilities } from '../__testing__/backup/backup-transport-session-test.utilities';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { DiProvider, defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { LeaseOptions } from '../leases/lease-options.model';
import { LeaseService } from '../leases/lease.service';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BackupTransportSessionInterface } from './transports/backup-transport-session.interface';
import { FsBackupTransport } from './transports/fs.backup-transport';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-concurrency-${UUIDUtilities.generate()}`);

/**
 * How many resources are being stored right now, and the most there were at once.
 */
const stores: { now: number, mostAtOnce: number } = { now: 0, mostAtOnce: 0 };

/**
 * How many times a record was stored.
 */
let recordsStored: number = 0;

@BackupTransport()
class CountingFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('counting-fs-backup-transport', backupFolder);
    }

    override async openSession(): Promise<BackupTransportSessionInterface> {
        return BackupTransportSessionTestUtilities.intercept(await super.openSession(), {
            put: async (key, data, put) => {
                if (BackupTransportSessionTestUtilities.isRecordKey(key)) {
                    recordsStored++;
                    await put(key, data);
                    return;
                }
                stores.now++;
                stores.mostAtOnce = Math.max(stores.mostAtOnce, stores.now);
                try {
                    // long enough for a second resource to start meanwhile, were it allowed to
                    await sleep(100);
                    await put(key, data);
                }
                finally {
                    stores.now--;
                }
            }
        });
    }
}

@DataSource()
class ConcurrencyDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource of the backup, holding a few bytes.
 */
abstract class SmallStore implements BackupResourceInterface {
    createBackupData(): Readable {
        return Readable.from([Buffer.from('a few bytes')]);
    }

    async restoreBackup(): Promise<void> {
        await Promise.resolve();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

@Backup({ transports: [CountingFsBackupTransport], encrypt: false })
class InvoicesStore extends SmallStore {}

@Backup({ transports: [CountingFsBackupTransport], encrypt: false })
class CustomersStore extends SmallStore {}

@Backup({ transports: [CountingFsBackupTransport], encrypt: false })
class ProductsStore extends SmallStore {}

/**
 * The lease service, holding the lease of one resource half a second after its work, as a data source
 * that is slow to answer the release does.
 */
class LingeringLeaseService extends LeaseService {
    override async withLease<T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>): Promise<T | undefined> {
        return await super.withLease(options, async lost => {
            const result: T = await fn(lost);
            if (options.key === `backup:resource:${InvoicesStore.name}`) {
                await sleep(500);
            }
            return result;
        });
    }
}

let server: StartedTestServer | undefined;

/**
 * The test providers, with the given limit when one is given.
 * @param maxConcurrent - How many resources an instance stores at once.
 * @returns The providers.
 */
function providersWith(maxConcurrent?: number): DiProvider<unknown>[] {
    return maxConcurrent == undefined
        ? defaultTestServerProviders
        : [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES, useValue: maxConcurrent })];
}

/**
 * Takes a backup of every resource, and answers how many were stored at once at most.
 * @returns The backup once it is done, and the most resources stored at once.
 */
async function takeBackup(): Promise<{ status: BackupStatus, mostAtOnce: number }> {
    stores.mostAtOnce = 0;
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const done: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: `concurrency-${UUIDUtilities.generate()}` }));
    return { status: done.status, mostAtOnce: stores.mostAtOnce };
}

beforeAll(async () => {
    // registered for the application, which reads every class marked with @Backup
    expect([InvoicesStore, CustomersStore, ProductsStore]).toHaveLength(3);
    server = await startTestServer({ dataSources: [ConcurrencyDataSource], providers: providersWith() });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

// an instance that saw ten due resources started ten dumps and ten staging files at once
describe('BackupService - resources stored at once by one instance', () => {
    it('stores one resource at a time by default, and every one of them', async () => {
        expect(await takeBackup()).toEqual({ status: BackupStatus.COMPLETED, mostAtOnce: 1 });
    }, TestTimeouts.inMemory.start);

    it('stores as many at once as BACKUP_MAX_CONCURRENT_RESOURCES says', async () => {
        await getServer().reInit({ dataSources: [ConcurrencyDataSource], providers: providersWith(3) });

        expect(await takeBackup()).toEqual({ status: BackupStatus.COMPLETED, mostAtOnce: 3 });
    }, TestTimeouts.inMemory.start * 2);

    // each resource finishing together with another completed the backup again: its record stored twice
    // and its retention applied twice
    it('completes a backup once when its resources finish together', async () => {
        await getServer().reInit({ dataSources: [ConcurrencyDataSource], providers: providersWith(3) });
        recordsStored = 0;

        await takeBackup();
        await firstValueFrom(inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).isCreatingBackup.pipe(first(creating => !creating)));

        expect(recordsStored).toBe(1);
    }, TestTimeouts.inMemory.start * 2);

    // a resource counted as stored while it still held its lease: the others completed the backup meanwhile,
    // and a restore right after was refused as though the resource were still being backed up
    it('restores a backup at once when it completed, while one resource still let go of its lease', async () => {
        await getServer().reInit({
            dataSources: [ConcurrencyDataSource],
            providers: [...providersWith(3), defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_SERVICE, useClass: LingeringLeaseService })]
        });
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);

        const done: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: `concurrency-${UUIDUtilities.generate()}` }));

        await expect(backupService.restore(done)).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.start * 2);

    it('refuses to start with a limit that would store nothing', async () => {
        await expect(getServer().reInit({ dataSources: [ConcurrencyDataSource], providers: providersWith(0) }))
            .rejects.toThrow('BACKUP_MAX_CONCURRENT_RESOURCES needs to be a whole number of at least 1, not 0');
    }, TestTimeouts.inMemory.start);
});

/**
 * Hands over the started server.
 * @returns The server.
 * @throws When the server did not start.
 */
function getServer(): StartedTestServer {
    if (server == undefined) {
        throw new Error('the server did not start');
    }
    return server;
}