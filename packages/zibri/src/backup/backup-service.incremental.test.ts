import assert from 'node:assert';
import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

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
import { ConflictError } from '../error-handling/errors/conflict.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { IncrementalBackupData } from './incremental-backup-data.model';
import { IncrementalBackupResourceInterface } from './incremental-backup-resource.interface';
import { FsBackupTransport } from './transports/fs.backup-transport';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-incremental-${UUIDUtilities.generate()}`);

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

@BackupTransport()
class IncrementalFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('incremental-fs-backup-transport', backupFolder);
    }
}

@DataSource()
class IncrementalDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * One change of the ledger: a value written, or deleted as null.
 */
type LedgerChange = {
    key: string,
    value: string | null
};

/**
 * Where a backup of the ledger reads on from: the changes of one run of it, from a position.
 */
type LedgerCursor = {
    run: string,
    position: number
};

/**
 * A resource keeping every change it was made, the way a replication slot does, so that a backup reads
 * only what changed since the one it builds on.
 */
@Backup({ transports: [IncrementalFsBackupTransport], encrypt: false })
class LedgerStore implements IncrementalBackupResourceInterface {
    readonly incrementalRead: boolean = true;

    entries: Map<string, string> = new Map();

    /**
     * How each backup read the ledger.
     */
    reads: ('full' | 'changes')[] = [];

    /**
     * The cursors confirmed, in the order they were.
     */
    confirmed: string[] = [];

    /**
     * What each restore was asked about whether it is whole: the data in full and each increment, as text.
     */
    judged: { full: string, increments: string[] }[] = [];

    private changes: LedgerChange[] = [];

    // a new run once the cursor is forgotten, after which no cursor of an earlier one reads on
    private run: string = UUIDUtilities.generate();

    write(key: string, value: string | null): void {
        if (value == undefined) {
            this.entries.delete(key);
        }
        else {
            this.entries.set(key, value);
        }
        this.changes.push({ key, value });
    }

    reset(): void {
        this.entries = new Map();
        this.reads = [];
        this.confirmed = [];
        this.judged = [];
        this.changes = [];
        this.run = UUIDUtilities.generate();
    }

    async resolveRestoresWhole(backupData: Readable, increments: Readable[]): Promise<boolean> {
        this.judged.push({ full: await readText(backupData), increments: await Promise.all(increments.map(async i => await readText(i))) });
        return true;
    }

    createBackupData(): Readable {
        return Readable.from([Buffer.from(JsonUtilities.stringify([...this.entries]))]);
    }

    async createIncrementalBackupData(_backup: BackupEntity, _options: unknown, since: string | undefined): Promise<IncrementalBackupData> {
        const cursor: string = JsonUtilities.stringify({ run: this.run, position: this.changes.length });
        const from: LedgerCursor | undefined = since == undefined ? undefined : JsonUtilities.parse<LedgerCursor>(since);
        if (from?.run !== this.run) {
            this.reads.push('full');
            return await Promise.resolve({ data: this.createBackupData(), full: true, cursor });
        }
        this.reads.push('changes');
        return { data: Readable.from([Buffer.from(JsonUtilities.stringify(this.changes.slice(from.position)))]), full: false, cursor };
    }

    async confirmReadCursor(cursor: string): Promise<void> {
        this.confirmed.push(cursor);
        await Promise.resolve();
    }

    async forgetReadCursor(): Promise<void> {
        this.run = UUIDUtilities.generate();
        await Promise.resolve();
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        this.entries = new Map(JsonUtilities.parse<[string, string][]>(await readText(backupData)));
    }

    async restoreIncrementalBackup(full: Readable, increments: Readable[]): Promise<void> {
        await this.restoreBackup(full);
        for (const increment of increments) {
            for (const change of JsonUtilities.parse<LedgerChange[]>(await readText(increment))) {
                if (change.value == undefined) {
                    this.entries.delete(change.key);
                }
                else {
                    this.entries.set(change.key, change.value);
                }
            }
        }
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * Reads a stream as text.
 * @param data - The stream.
 * @returns The text.
 */
async function readText(data: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString();
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

/**
 * Takes a backup, and waits until the pass that stored it is over, retention included.
 * @param name - The name of the backup.
 * @returns The backup, completed.
 */
async function takeBackup(name: string): Promise<BackupEntity> {
    const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name }));
    await firstValueFrom(getBackupService().isCreatingBackup.pipe(first(creating => !creating)));
    return backup;
}

function getLedger(backup: BackupEntity): BackupResourceEntity {
    const resource: BackupResourceEntity | undefined = backup.resources.find(r => r.name === LedgerStore.name);
    assert(resource, 'the backup holds no ledger');
    return resource;
}

async function findBackupNames(): Promise<string[]> {
    return (await inject(repositoryTokenFor(BackupEntity)).findAll({ limit: 'all' })).map(b => b.name).sort();
}

describe('BackupService - a resource reading only what changed', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({
            dataSources: [IncrementalDataSource],
            providers: [
                ...defaultTestServerProviders,
                // keeps only the newest backup, and what it builds on
                defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_RETENTION, useValue: { timeZone: 'UTC', last: 1 } })
            ]
        });
    }, TestTimeouts.inMemory.start);

    beforeEach(() => {
        inject(LedgerStore).reset();
    });

    afterEach(async () => {
        const backups: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({ relations: ['resources'], limit: 'all' });
        // the newest first, so that no backup is deleted while another one builds on it
        for (const backup of backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
            await getBackupService().delete(backup);
        }
    });

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(backupFolder);
    }, TestTimeouts.inMemory.shutdown);

    it('builds a backup on the one before it, and restores it from the one in full and what changed since', async () => {
        const ledger: LedgerStore = inject(LedgerStore);
        ledger.write('a', '1');
        const firstBackup: BackupEntity = await takeBackup('first');
        ledger.write('b', '2');
        ledger.write('a', null);
        const secondBackup: BackupEntity = await takeBackup('second');
        ledger.write('c', '3');

        expect(ledger.reads).toStrictEqual(['full', 'changes']);
        expect(getLedger(firstBackup).baseBackupId).toBeNull();
        expect(getLedger(secondBackup).baseBackupId).toBe(firstBackup.id);
        // the retention keeps the newest, and the one it builds on
        expect(await findBackupNames()).toStrictEqual(['first', 'second']);

        await getBackupService().restore(secondBackup);
        expect([...ledger.entries]).toStrictEqual([['b', '2']]);
        await getBackupService().restore(firstBackup);
        expect([...ledger.entries]).toStrictEqual([['a', '1']]);
    }, 20000);

    it('asks whether a restore is whole of the data in full and of what changed since', async () => {
        const ledger: LedgerStore = inject(LedgerStore);
        ledger.write('a', '1');
        await takeBackup('first');
        ledger.write('b', '2');
        const secondBackup: BackupEntity = await takeBackup('second');

        await getBackupService().restore(secondBackup);
        expect(ledger.judged).toStrictEqual([
            {
                full: JsonUtilities.stringify([['a', '1']]),
                increments: [JsonUtilities.stringify([{ key: 'b', value: '2' }])]
            }
        ]);
    }, 20000);

    it('confirms where the next backup reads on from once a backup completed', async () => {
        const backup: BackupEntity = await takeBackup('confirmed');

        expect(inject(LedgerStore).confirmed).toStrictEqual([getLedger(backup).readCursor]);
    }, 20000);

    it('reads in full once the backup in full its chain starts at is of an earlier week, and lets the old chain go', async () => {
        const ledger: LedgerStore = inject(LedgerStore);
        ledger.write('a', '1');
        const lastWeek: BackupEntity = await takeBackup('last week');
        await inject(repositoryTokenFor(BackupEntity)).updateById(lastWeek.id, { createdAt: new Date(Date.now() - (8 * DAY_IN_MS)) });
        ledger.write('b', '2');
        const thisWeek: BackupEntity = await takeBackup('this week');

        expect(ledger.reads).toStrictEqual(['full', 'full']);
        expect(getLedger(thisWeek).baseBackupId).toBeNull();
        expect(await findBackupNames()).toStrictEqual(['this week']);
    }, 20000);

    it('reads in full after a restore replaced the data', async () => {
        const ledger: LedgerStore = inject(LedgerStore);
        ledger.write('a', '1');
        const restored: BackupEntity = await takeBackup('restored');
        await getBackupService().restore(restored);
        const next: BackupEntity = await takeBackup('after the restore');

        expect(ledger.reads).toStrictEqual(['full', 'full']);
        expect(getLedger(next).baseBackupId).toBeNull();
    }, 20000);

    it('refuses to delete a backup another one builds on, and deletes it once that one is gone', async () => {
        const base: BackupEntity = await takeBackup('base');
        const building: BackupEntity = await takeBackup('building');

        await expect(getBackupService().delete(base)).rejects.toThrow(ConflictError);
        expect(await findBackupNames()).toStrictEqual(['base', 'building']);
        await getBackupService().delete(building);
        await getBackupService().delete(base);
        expect(await findBackupNames()).toStrictEqual([]);
    }, 20000);
});