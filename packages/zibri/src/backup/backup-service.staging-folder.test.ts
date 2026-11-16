import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupResourceMetadata } from './decorators/backup-resource-metadata.model';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { StagingUtilities } from './staging.utilities';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What passes through this instance's disk on the way to and from a transport: the data of a backup, the
 * data a restore fetched, and the snapshot it keeps to put back, each compressed.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-staging-folder-${UUIDUtilities.generate()}`);

@BackupTransport()
class StagingFolderFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('staging-folder-fs-backup-transport', backupFolder);
    }
}

@DataSource()
class StagingFolderDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * Data the way a dump mostly is: text, repeating itself. Several MiB, so that a copy on the disk as large
 * as it cannot pass for a compressed one.
 * @param label - What tells two values apart.
 * @returns The data.
 */
function resolveDumpLike(label: string): string {
    return `INSERT INTO task (title, assignee) VALUES ('${label}', 'ada@example.com');\n`.repeat(60_000);
}

/**
 * The backup a restore running now restores, which the resources measure the staging folder for.
 */
let restoring: BackupEntity | undefined;

/**
 * The sizes of the files the staging folder holds of a backup, by their name, which starts with its id.
 * @param backup - The backup.
 * @returns The sizes.
 */
async function resolveStagedSizes(backup: BackupEntity): Promise<Record<string, number>> {
    const folder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
    const names: string[] = (await FsUtilities.readdir(folder)).filter(f => f.isFile() && f.name.startsWith(backup.id)).map(f => f.name);
    const sizes: number[] = await Promise.all(names.map(async name => (await FsUtilities.stat(FsUtilities.getPath(folder, name))).size));
    return Object.fromEntries(names.map((name, i) => [name, sizes[i] ?? 0]));
}

/**
 * Finds the files of the staging folder that read without a key, as they would for anybody reading
 * the disk: as a compressed file, or as the chunks of one.
 * @param names - The names of the files.
 * @returns The names of those that do.
 */
async function findReadableWithoutKey(names: string[]): Promise<string[]> {
    const folder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
    const readable: boolean[] = await Promise.all(names.map(async name => {
        const p: FsPath = FsUtilities.getPath(folder, name);
        try {
            await text(StagingUtilities.read({ path: p, compression: 'zstd', encryption: undefined }));
            return true;
        }
        catch {
            // not a compressed file anybody reads
        }
        const chunks: Readable = StagingUtilities.read({ path: p, compression: 'chunks', key: undefined, size: 0, checksum: '' });
        try {
            // the first chunk is enough: the size and the checksum it is read with here are only checked at the end of the data
            for await (const piece of chunks) {
                return Buffer.isBuffer(piece) && piece.length > 0;
            }
            return false;
        }
        catch {
            return false;
        }
        finally {
            chunks.destroy();
        }
    }));
    return names.filter((_, i) => readable[i] == true);
}

/**
 * A resource holding one value, which notes what the staging folder holds of the backup while it is
 * backed up and while it is restored.
 */
abstract class MeasuredStore implements BackupResourceInterface {
    value: string = '';

    /**
     * The files the staging folder held of the backup once the resource handed over all of its data.
     */
    stagedWhileBackingUp: Record<string, number> = {};

    /**
     * The files the staging folder held of the backup while a restore applied the resource.
     */
    stagedWhileApplying: Record<string, number> = {};

    /**
     * Of those, the ones anybody reading the disk could decompress without a key.
     */
    readableWhileApplying: string[] = [];

    createBackupData(backup: BackupEntity): Readable {
        const value: string = this.value;
        const note: (sizes: Record<string, number>) => void = sizes => this.stagedWhileBackingUp = sizes;
        return Readable.from((async function* produce(): AsyncGenerator<Buffer> {
            yield Buffer.from(value);
            // long enough for what was handed over to reach the disk, before the data ends and the file is removed
            await sleep(500);
            note(await resolveStagedSizes(backup));
        })());
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        if (restoring != undefined) {
            this.stagedWhileApplying = await resolveStagedSizes(restoring);
            this.readableWhileApplying = await findReadableWithoutKey(Object.keys(this.stagedWhileApplying));
        }
        this.value = Buffer.concat(chunks).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

// encrypted, so that the copy on the disk is compressed before it is encrypted, which leaves nothing to compress
@Backup({ transports: [StagingFolderFsBackupTransport], encrypt: true })
class FirstMeasuredStore extends MeasuredStore {}

@Backup({ transports: [StagingFolderFsBackupTransport], encrypt: true })
class SecondMeasuredStore extends MeasuredStore {}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [StagingFolderDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - what passes through this instance\'s disk', () => {
    it('stages the data of a backup compressed, and restores it as it was', async () => {
        const backedUp: string = resolveDumpLike('backed up');
        inject(FirstMeasuredStore).value = backedUp;
        inject(SecondMeasuredStore).value = backedUp;
        const backup: BackupEntity = await getBackupService().waitForBackup(
            await getBackupService().queueBackup({ name: `staging-folder-${UUIDUtilities.generate()}` })
        );

        const whileBackingUp: number[] = Object.values(inject(FirstMeasuredStore).stagedWhileBackingUp);
        expect(whileBackingUp).toHaveLength(1);
        expect(whileBackingUp[0]).toBeGreaterThan(0);
        expect(whileBackingUp[0]).toBeLessThan(backedUp.length / 10);

        // what each resource holds now is what the snapshot of the restore copies
        inject(FirstMeasuredStore).value = resolveDumpLike('current');
        inject(SecondMeasuredStore).value = resolveDumpLike('current');
        restoring = backup;
        try {
            await getBackupService().restore(backup);
        }
        finally {
            restoring = undefined;
        }

        // the data fetched of both resources, and a snapshot of each, as the first one is applied. The
        // journal naming the snapshots is a few bytes
        const whileApplying: Record<string, number> = Object.fromEntries(Object.entries(inject(FirstMeasuredStore).stagedWhileApplying)
            .filter(([name]) => !name.endsWith('.restore-journal.json')));
        expect(Object.keys(whileApplying).filter(name => name.endsWith('-before'))).toHaveLength(2);
        expect(Object.keys(whileApplying)).toHaveLength(4);
        for (const size of Object.values(whileApplying)) {
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThan(backedUp.length / 10);
        }
        // both resources are encrypted: neither what was fetched of them nor what they held reads without a key
        expect(inject(FirstMeasuredStore).readableWhileApplying.filter(name => !name.endsWith('.restore-journal.json'))).toStrictEqual([]);
        expect(inject(FirstMeasuredStore).value).toBe(backedUp);
        expect(inject(SecondMeasuredStore).value).toBe(backedUp);
    }, 60000);

    // the chunks a restore fetched are stored compressed already. Staged as their data, they were compressed again,
    // encrypted, and read back through both, which cost a restore of 100 MB of postgres more CPU than its dump in one
    // piece. What a resource holds is staged compressed still, as its snapshot
    it('stages the chunks a restore fetched as they were stored, compressing only the snapshots of what it replaces', async () => {
        const backedUp: string = resolveDumpLike('backed up as chunks');
        inject(FirstMeasuredStore).value = backedUp;
        inject(SecondMeasuredStore).value = backedUp;
        const backup: BackupEntity = await getBackupService().waitForBackup(
            await getBackupService().queueBackup({ name: `staging-folder-${UUIDUtilities.generate()}` })
        );
        inject(FirstMeasuredStore).value = resolveDumpLike('current');
        inject(SecondMeasuredStore).value = resolveDumpLike('current');

        const compress: jest.SpiedFunction<typeof StagingUtilities.compress> = jest.spyOn(StagingUtilities, 'compress');
        let compressed: number;
        try {
            await getBackupService().restore(backup);
            compressed = compress.mock.calls.length;
        }
        finally {
            compress.mockRestore();
        }

        expect(compressed).toBe(2);
        expect(inject(FirstMeasuredStore).value).toBe(backedUp);
        expect(inject(SecondMeasuredStore).value).toBe(backedUp);
    }, 60000);

    // its chunks are stored unencrypted, and staged as they were stored they would be on this disk for anybody
    // to read, where a resource marked with encrypt is to be encrypted
    it('encrypts on this disk what a restore fetched of a backup taken before the resource was marked with encrypt', async () => {
        const marked: BackupResourceMetadata | undefined = MetadataUtilities.getBackupResourceMetadata(FirstMeasuredStore);
        if (marked == undefined) {
            throw new Error('The store is not marked with @Backup.');
        }
        const backedUp: string = resolveDumpLike('backed up unencrypted');
        inject(FirstMeasuredStore).value = backedUp;
        inject(SecondMeasuredStore).value = backedUp;
        let backup: BackupEntity;
        MetadataUtilities.setBackupResourceMetadata(FirstMeasuredStore, { ...marked, encrypt: false });
        try {
            backup = await getBackupService().waitForBackup(
                await getBackupService().queueBackup({ name: `staging-folder-${UUIDUtilities.generate()}` })
            );
        }
        finally {
            MetadataUtilities.setBackupResourceMetadata(FirstMeasuredStore, marked);
        }
        inject(FirstMeasuredStore).value = resolveDumpLike('current');
        inject(SecondMeasuredStore).value = resolveDumpLike('current');

        restoring = backup;
        try {
            await getBackupService().restore(backup);
        }
        finally {
            restoring = undefined;
        }

        expect(inject(FirstMeasuredStore).readableWhileApplying.filter(name => !name.endsWith('.restore-journal.json'))).toStrictEqual([]);
        expect(inject(FirstMeasuredStore).value).toBe(backedUp);
        expect(inject(SecondMeasuredStore).value).toBe(backedUp);
    }, 60000);
});