import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupLayoutTestUtilities } from '../__testing__/backup/backup-layout-test.utilities';
import { S3StandIn } from '../__testing__/backup/s3-stand-in.model';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { BackupChunkEntity } from '../backup/backup-chunk-entity.model';
import { BackupEntity } from '../backup/backup-entity.model';
import { BackupResourceEntity } from '../backup/backup-resource-entity.model';
import { BackupServiceInterface } from '../backup/backup-service.interface';
import { Backup } from '../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../backup/decorators/backup-transport.decorator';
import { S3TenantBackupTransportKind } from '../backup/tenant/s3.tenant-backup-transport-kind';
import { TenantBackupTransport } from '../backup/tenant/tenant-backup-transport.model';
import { FsBackupTransport } from '../backup/transports/fs.backup-transport';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { FileStore } from './decorators/file-store.decorator';
import { FileRecord } from './file-record.model';
import { FileServiceInterface } from './file-service.interface';
import { FileStoreEntry } from './stores/file-store-entry.model';
import { FsFileStore } from './stores/fs.file-store';

/**
 * A file store backed up beside the data source of its rows, each to a folder of its own, so that what a backup adds
 * to the transport of the files is what it stored of them alone.
 */

const folder: FsPath = FsUtilities.getPath(testFileFolder, `file-store-backup-${UUIDUtilities.generate()}`);
const filesBackupFolder: FsPath = FsUtilities.getPath(folder, 'file-backups');
const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(folder, 'tenant-bucket'));
// small, so that a few files of some KiB take many chunks
const CHUNK_BYTES: number = 32 * 1024;
const MAX_CHUNK_BYTES: number = 64 * 1024;

@BackupTransport()
class RowsBackupTransport extends FsBackupTransport {
    constructor() {
        super('rows-backup-transport', FsUtilities.getPath(folder, 'row-backups'));
    }
}

@BackupTransport()
class FilesBackupTransport extends FsBackupTransport {
    constructor() {
        super('files-backup-transport', filesBackupFolder);
    }
}

@FileStore()
@Backup({ transports: [FilesBackupTransport], encrypt: true })
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', FsUtilities.getPath(folder, 'documents'));
    }
}

// not marked with @Backup: its rows are backed up with their data source, and its bytes are not
@FileStore()
class ScanFileStore extends FsFileStore {
    constructor() {
        super('scans', FsUtilities.getPath(folder, 'scans'));
    }
}

@DataSource()
@Backup({ transports: [RowsBackupTransport], encrypt: true })
class FilesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        FileRecord,
        BackupEntity,
        BackupResourceEntity,
        BackupChunkEntity,
        TenantBackupTransport
    ];

    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getFileService(): FileServiceInterface {
    return inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

async function storeFile(tenantId: string, name: string, data: Buffer, store: string = 'documents'): Promise<FileRecord> {
    return await asTenant(tenantId, async () => await getFileService().store({ store, name, mimeType: 'application/pdf', data }));
}

async function readFile(file: FileRecord): Promise<Buffer> {
    return await asTenant(file.tenantId, async () => await getFileService().read(file.id));
}

async function findFile(file: FileRecord): Promise<FileRecord | undefined> {
    return await asTenant(file.tenantId, async () => await getFileService().findFile(file.id));
}

async function findStored(file: FileRecord): Promise<FileStoreEntry | undefined> {
    return await inject(DocumentFileStore).findEntry(file.key);
}

/**
 * The bytes the chunks of the transport of the files take.
 * @returns The bytes.
 */
async function resolveStoredChunkBytes(): Promise<number> {
    const paths: FsPath[] = await BackupLayoutTestUtilities.findChunkPaths(filesBackupFolder);
    const sizes: number[] = await Promise.all(paths.map(async p => (await FsUtilities.stat(p)).size));
    return sizes.reduce((sum, size) => sum + size, 0);
}

/**
 * Gives a tenant a bucket of its own on the stand-in, which its backups go to.
 * @param tenantId - The tenant.
 */
async function giveBucket(tenantId: string): Promise<void> {
    const create: BackupServiceInterface['createTenantBackupTransport'] = getBackupService().createTenantBackupTransport;
    assert(create, 'the backup service takes no transports of tenants');
    await create.call(getBackupService(), tenantId, {
        name: 'own bucket',
        kind: 's3',
        settings: { endpoint: standIn.getEndpoint(), bucket: 'tenant-backups', region: 'us-east-1', accessKeyId: 'tenant-key', addressingStyle: 'path' },
        secret: { secretAccessKey: 'tenant-secret' }
    });
}

/**
 * Takes a backup, and waits until the pass that stored it is over.
 * @param name - The name of the backup.
 * @param tenantId - The tenant to back up, or undefined for the application.
 * @returns The backup, completed.
 */
async function takeBackup(name: string, tenantId?: string): Promise<BackupEntity> {
    const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name, tenantId }));
    await firstValueFrom(getBackupService().isCreatingBackup.pipe(first(creating => !creating)));
    return backup;
}

/**
 * The warnings logged while some work runs.
 * @param work - The work.
 * @returns The warnings.
 */
async function resolveWarnings(work: () => Promise<void>): Promise<string[]> {
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
    try {
        await work();
        return warn.mock.calls.map(([message]) => message);
    }
    finally {
        warn.mockRestore();
    }
}

describe('A file store marked with @Backup', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        await standIn.start();
        server = await startTestServer({
            dataSources: [FilesDataSource],
            fileStores: [DocumentFileStore, ScanFileStore],
            providers: [
                ...defaultTestServerProviders,
                // both at once, so that only the order the backup keeps stores the files after their rows
                defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES, useValue: 2 }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS,
                    useValue: { minChunkBytes: 16 * 1024, averageChunkBytes: CHUNK_BYTES, maxChunkBytes: MAX_CHUNK_BYTES, compressionLevel: 3 }
                }),
                // the stand-in answers over plain http on this machine
                defineProvider({
                    token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                    useValue: { kinds: [new S3TenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: true }
                })
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
        await standIn.stop();
        await FsUtilities.rm(folder);
    }, TestTimeouts.inMemory.shutdown);

    it('is backed up beside the data source of its rows, and a restore of both brings back every file byte for byte', async () => {
        const tenant: string = UUIDUtilities.generate();
        const invoice: Buffer = randomBytes(40 * 1024);
        const receipt: Buffer = randomBytes(40 * 1024);
        const statement: Buffer = randomBytes(40 * 1024);
        const removed: FileRecord = await storeFile(tenant, 'invoice.pdf', invoice);
        const sharing: FileRecord = await storeFile(tenant, 'invoice-copy.pdf', invoice);
        const altered: FileRecord = await storeFile(tenant, 'receipt.pdf', receipt);
        const deleted: FileRecord = await storeFile(tenant, 'statement.pdf', statement);
        const scan: FileRecord = await storeFile(tenant, 'scan.pdf', randomBytes(1024), 'scans');
        const backup: BackupEntity = await takeBackup('files and rows');

        const store: DocumentFileStore = inject(DocumentFileStore);
        await store.delete([removed.key]);
        await store.put(altered.key, Readable.from([randomBytes(receipt.length)]));
        await asTenant(tenant, async () => await getFileService().delete(deleted.id));
        await store.delete([deleted.key]);
        const since: FileRecord = await storeFile(tenant, 'since.pdf', randomBytes(1024));

        expect(backup.resources.map(r => r.name).sort()).toStrictEqual(['DocumentFileStore', 'FilesDataSource']);
        const warnings: string[] = await resolveWarnings(async () => await getBackupService().restore(backup));

        expect(await readFile(removed)).toStrictEqual(invoice);
        expect(await readFile(sharing)).toStrictEqual(invoice);
        expect(await readFile(altered)).toStrictEqual(receipt);
        expect(await readFile(deleted)).toStrictEqual(statement);
        // read checks the bytes against the SHA-256 of the row, which the restore brought back with it
        expect((await findFile(altered))?.sha256).toBe(altered.sha256);
        // the files of a store not marked with @Backup keep their bytes, and their rows come back
        expect(await readFile(scan)).toHaveLength(1024);
        // the row is gone with the data source restored, and its bytes are left to the cleanup
        expect(await findFile(since)).toBeUndefined();
        expect(await findStored(since)).toBeDefined();
        expect(warnings.filter(w => w.includes('have no bytes'))).toStrictEqual([]);
    }, 30000);

    it('stores the files after the data source of their rows, even with room to store both at once', async () => {
        await storeFile(UUIDUtilities.generate(), 'ordered.pdf', randomBytes(1024));
        const resources: () => Promise<BackupResourceEntity[]> = async () => await inject(repositoryTokenFor(BackupResourceEntity))
            .findAll({ where: { name: 'FilesDataSource', completed: false }, limit: 'all' });
        const store: DocumentFileStore = inject(DocumentFileStore);
        const findEntry: (key: string) => Promise<FileStoreEntry | undefined> = store.findEntry.bind(store);
        const rowsStoredBefore: number[] = [];
        jest.spyOn(store, 'findEntry').mockImplementation(async key => {
            rowsStoredBefore.push((await resources()).length);
            return await findEntry(key);
        });

        await takeBackup('ordered');

        expect(rowsStoredBefore.length).toBeGreaterThan(0);
        expect(new Set(rowsStoredBefore)).toStrictEqual(new Set([0]));
    }, 30000);

    it('adds the chunks of the files stored since to the transport, rather than the store anew', async () => {
        const tenant: string = UUIDUtilities.generate();
        for (let i: number = 0; i < 24; i++) {
            await storeFile(tenant, `receipt-${i}.pdf`, randomBytes(48 * 1024));
        }
        await takeBackup('before the new file');
        const before: number = await resolveStoredChunkBytes();
        const added: FileRecord = await storeFile(tenant, 'added.pdf', randomBytes(48 * 1024));

        await takeBackup('with the new file');

        const grownBy: number = await resolveStoredChunkBytes() - before;
        expect(before).toBeGreaterThan(24 * 48 * 1024);
        // the new file, and the last chunk of the backup before, which its end cut short
        expect(grownBy).toBeGreaterThanOrEqual(added.size);
        expect(grownBy).toBeLessThan(added.size + (2 * MAX_CHUNK_BYTES));
    }, 60000);

    it('backs up the files of a tenant in a backup of the tenant, and restores those alone', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const ofA: Buffer = randomBytes(4096);
        const ofB: Buffer = randomBytes(4096);
        const fileOfA: FileRecord = await storeFile(tenantA, 'a.pdf', ofA);
        const fileOfB: FileRecord = await storeFile(tenantB, 'b.pdf', ofB);
        await giveBucket(tenantA);
        const backup: BackupEntity = await takeBackup('tenant a', tenantA);
        const store: DocumentFileStore = inject(DocumentFileStore);
        await store.delete([fileOfA.key, fileOfB.key]);

        expect(backup.resources.map(r => r.name).sort()).toStrictEqual(['DocumentFileStore', 'FilesDataSource']);
        const warnings: string[] = await resolveWarnings(async () => await getBackupService().restore(backup));

        expect(await readFile(fileOfA)).toStrictEqual(ofA);
        // never in the backup of the tenant
        expect(await findStored(fileOfB)).toBeUndefined();
        // checked of the tenant restored alone
        expect(warnings.some(w => w.includes(fileOfB.id))).toBe(false);
        await store.put(fileOfB.key, Readable.from([ofB]));
    }, 30000);

    it('warns after a restore of the rows alone about the files whose bytes are gone, and a restore of the store puts them back', async () => {
        const tenant: string = UUIDUtilities.generate();
        const contract: Buffer = randomBytes(2048);
        const file: FileRecord = await storeFile(tenant, 'contract.pdf', contract);
        const backup: BackupEntity = await takeBackup('rows alone');
        await asTenant(tenant, async () => await getFileService().delete(file.id));
        await inject(DocumentFileStore).delete([file.key]);

        const rowsWarnings: string[] = await resolveWarnings(
            async () => await getBackupService().restore(backup, { resources: ['FilesDataSource'] })
        );

        expect(await findFile(file)).toBeDefined();
        expect(await findStored(file)).toBeUndefined();
        const warning: string | undefined = rowsWarnings.find(w => w.includes(file.id));
        expect(warning).toContain('"contract.pdf"');
        expect(warning).toContain('A restore of DocumentFileStore from a backup holding them puts them back.');

        const storeWarnings: string[] = await resolveWarnings(
            async () => await getBackupService().restore(backup, { resources: ['DocumentFileStore'] })
        );

        expect(await readFile(file)).toStrictEqual(contract);
        expect(storeWarnings.some(w => w.includes(file.id))).toBe(false);
    }, 30000);

    it('puts back the bytes alone on a restore of the store alone, and warns about a file stored since whose bytes are gone', async () => {
        const tenant: string = UUIDUtilities.generate();
        const kept: Buffer = randomBytes(2048);
        const backedUp: FileRecord = await storeFile(tenant, 'backed-up.pdf', kept);
        const backup: BackupEntity = await takeBackup('store alone');
        const since: FileRecord = await storeFile(tenant, 'since.pdf', randomBytes(2048));
        await inject(DocumentFileStore).delete([backedUp.key, since.key]);

        const warnings: string[] = await resolveWarnings(
            async () => await getBackupService().restore(backup, { resources: ['DocumentFileStore'] })
        );

        expect(await readFile(backedUp)).toStrictEqual(kept);
        // the rows stay as they are
        expect(await findFile(since)).toBeDefined();
        expect(warnings.some(w => w.includes(since.id))).toBe(true);
        expect(warnings.some(w => w.includes(backedUp.id))).toBe(false);
        await asTenant(tenant, async () => await getFileService().delete(since.id));
    }, 30000);
});