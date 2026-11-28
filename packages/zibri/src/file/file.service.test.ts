import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { runWithApplicationClockAhead } from '../__testing__/run-with-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { FileStore } from './decorators/file-store.decorator';
import { FileHashMismatchError } from './file-hash-mismatch.error';
import { FileRecord } from './file-record.model';
import { FileServiceInterface } from './file-service.interface';
import { FsFileStore } from './stores/fs.file-store';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `file-service-${UUIDUtilities.generate()}`);

@FileStore()
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', folder);
    }
}

@DataSource()
class FileDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, FileRecord];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [FileDataSource], fileStores: [DocumentFileStore] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(folder);
}, TestTimeouts.inMemory.shutdown);

function getFileService(): FileServiceInterface {
    return inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
}

function getRecords(): Repository<FileRecord> {
    return inject(repositoryTokenFor(FileRecord));
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * The keys the store holds of a tenant.
 * @param tenantId - The tenant.
 * @returns The keys, sorted.
 */
async function findStoredKeys(tenantId: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const page of inject(DocumentFileStore).findKeys(`${tenantId}/`)) {
        keys.push(...page);
    }
    return keys.sort();
}

describe('FileService, in a folder store', () => {
    it('stores a file from its bytes and reads it back byte for byte, with what it is in its row', async () => {
        const tenant: string = UUIDUtilities.generate();
        const data: Buffer = Buffer.from('%PDF-1.7 an invoice');

        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'invoice-2026-11.pdf',
            mimeType: 'application/pdf',
            data,
            createdBy: 'a1b2c3d4-0000-4000-8000-000000000000'
        }));

        expect(stored).toMatchObject({
            name: 'invoice-2026-11.pdf',
            mimeType: 'application/pdf',
            size: data.length,
            storeName: 'documents',
            tenantId: tenant,
            createdBy: 'a1b2c3d4-0000-4000-8000-000000000000'
        });
        expect(stored.sha256).toMatch(/^[\da-f]{64}$/);
        expect(stored.key).toBe(`${tenant}/${stored.sha256.slice(0, 2)}/${stored.sha256}`);
        expect(stored.createdAt).toBeInstanceOf(Date);
        expect(await asTenant(tenant, async () => await getFileService().findFile(stored.id))).toMatchObject({ id: stored.id });
        expect((await asTenant(tenant, async () => await getFileService().read(stored.id))).equals(data)).toBe(true);
    });

    it('stores a file from a stream without keeping it in the staging folder, and reads it back as a stream', async () => {
        const tenant: string = UUIDUtilities.generate();
        const chunks: Buffer[] = Array.from({ length: 5 }, () => randomBytes(64 * 1024));

        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'scan.png',
            mimeType: 'image/png',
            data: Readable.from(chunks)
        }));
        const read: Buffer = await asTenant(tenant, async () => await buffer(await getFileService().readStream(stored.id)));

        expect(stored.size).toBe(5 * 64 * 1024);
        expect(stored.createdBy).toBeNull();
        expect(read.equals(Buffer.concat(chunks))).toBe(true);
        const staging: FsPath = inject(ZIBRI_DI_TOKENS.FILE_STAGING_FOLDER);
        expect(await FsUtilities.exists(staging) ? await FsUtilities.readdir(staging) : []).toEqual([]);
    });

    it('refuses bytes changed in the store, with an error naming the file, read whole and as a stream', async () => {
        const tenant: string = UUIDUtilities.generate();
        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'receipt.txt',
            mimeType: 'text/plain',
            data: Buffer.from('total: 12.00 EUR')
        }));
        // as long as it was, so that only the hash tells
        await FsUtilities.upsertFile(FsUtilities.getPath(folder, ...stored.key.split('/')), 'total: 99.00 EUR');

        const whole: Promise<Buffer> = asTenant(tenant, async () => await getFileService().read(stored.id));
        await expect(whole).rejects.toBeInstanceOf(FileHashMismatchError);
        await expect(whole).rejects.toThrow(`The file "receipt.txt" (${stored.id})`);
        await expect(asTenant(tenant, async () => await buffer(await getFileService().readStream(stored.id))))
            .rejects.toBeInstanceOf(FileHashMismatchError);
    });

    it('keeps the same content stored twice once, as two rows', async () => {
        const tenant: string = UUIDUtilities.generate();
        const data: Buffer = Buffer.from('the same bank statement');

        const [first, second] = await asTenant(tenant, async () => [
            await getFileService().store({ store: 'documents', name: 'statement.xml', mimeType: 'application/xml', data }),
            await getFileService().store({ store: 'documents', name: 'statement-again.xml', mimeType: 'application/xml', data })
        ]);

        expect(first?.id).not.toBe(second?.id);
        expect(first?.key).toBe(second?.key);
        expect(await findStoredKeys(tenant)).toEqual([first?.key]);
    });

    it('deletes the bytes with the last row of the same content, once they were not written for a day', async () => {
        const tenant: string = UUIDUtilities.generate();
        const data: Buffer = Buffer.from('a receipt kept twice');
        const [first, second] = await asTenant(tenant, async () => [
            await getFileService().store({ store: 'documents', name: 'first.txt', mimeType: 'text/plain', data }),
            await getFileService().store({ store: 'documents', name: 'second.txt', mimeType: 'text/plain', data })
        ]);
        if (first == undefined || second == undefined) {
            throw new Error('The files were not stored.');
        }

        await runWithApplicationClockAhead(2 * Ms.DAY, async () => await asTenant(tenant, async () => await getFileService().delete(first.id)));
        expect(await asTenant(tenant, async () => await getFileService().findFile(first.id))).toBeUndefined();
        // the other row still references them
        expect((await asTenant(tenant, async () => await getFileService().read(second.id))).equals(data)).toBe(true);

        await runWithApplicationClockAhead(2 * Ms.DAY, async () => await asTenant(tenant, async () => await getFileService().delete(second.id)));
        expect(await findStoredKeys(tenant)).toEqual([]);
    });

    it('leaves the bytes of a file deleted right after it was stored to the cleanup, which deletes them a day later', async () => {
        const tenant: string = UUIDUtilities.generate();
        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'draft.txt',
            mimeType: 'text/plain',
            data: Buffer.from('a draft')
        }));

        await asTenant(tenant, async () => await getFileService().delete(stored.id));
        // a store of the same content may be about to reference them
        expect(await findStoredKeys(tenant)).toEqual([stored.key]);
        await getFileService().deleteUnreferencedFiles();
        expect(await findStoredKeys(tenant)).toEqual([stored.key]);

        await runWithApplicationClockAhead(2 * Ms.DAY, async () => await getFileService().deleteUnreferencedFiles());
        expect(await findStoredKeys(tenant)).toEqual([]);
    });

    it('deletes the bytes a rolled back transaction stored, a day later, and keeps those a row references', async () => {
        const tenant: string = UUIDUtilities.generate();
        const kept: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'kept.txt',
            mimeType: 'text/plain',
            data: Buffer.from('kept')
        }));

        const transaction: Transaction = await getRecords().dataSource.startTransaction();
        const rolledBack: FileRecord = await asTenant(tenant, async () => await getFileService().store(
            { store: 'documents', name: 'rolled-back.txt', mimeType: 'text/plain', data: Buffer.from('rolled back') },
            transaction
        ));
        await transaction.rollback();
        expect(await asTenant(tenant, async () => await getFileService().findFile(rolledBack.id))).toBeUndefined();
        expect(await findStoredKeys(tenant)).toEqual([kept.key, rolledBack.key].sort());

        await runWithApplicationClockAhead(2 * Ms.DAY, async () => await getFileService().deleteUnreferencedFiles());

        expect(await findStoredKeys(tenant)).toEqual([kept.key]);
        expect((await asTenant(tenant, async () => await getFileService().read(kept.id))).toString()).toBe('kept');
    });

    it('keeps the row and the bytes of a file whose delete was rolled back', async () => {
        const tenant: string = UUIDUtilities.generate();
        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'contract.pdf',
            mimeType: 'application/pdf',
            data: Buffer.from('signed')
        }));

        await runWithApplicationClockAhead(2 * Ms.DAY, async () => {
            const transaction: Transaction = await getRecords().dataSource.startTransaction();
            await asTenant(tenant, async () => await getFileService().delete(stored.id, transaction));
            await transaction.rollback();
        });

        expect((await asTenant(tenant, async () => await getFileService().read(stored.id))).toString()).toBe('signed');
    });

    it('keeps the files of one tenant out of another\'s reach, and the same content of two tenants apart', async () => {
        const owner: string = UUIDUtilities.generate();
        const other: string = UUIDUtilities.generate();
        const data: Buffer = Buffer.from('a payslip');
        const stored: FileRecord = await asTenant(owner, async () => await getFileService().store({
            store: 'documents',
            name: 'payslip.pdf',
            mimeType: 'application/pdf',
            data
        }));
        const others: FileRecord = await asTenant(other, async () => await getFileService().store({
            store: 'documents',
            name: 'payslip.pdf',
            mimeType: 'application/pdf',
            data
        }));

        expect(await asTenant(other, async () => await getFileService().findFile(stored.id))).toBeUndefined();
        await expect(asTenant(other, async () => await getFileService().read(stored.id))).rejects.toBeInstanceOf(NotFoundError);
        await expect(asTenant(other, async () => await getFileService().delete(stored.id))).rejects.toBeInstanceOf(NotFoundError);
        expect(others.key).not.toBe(stored.key);
        expect(await findStoredKeys(owner)).toEqual([stored.key]);
    });

    it('refuses a store no file store is named', async () => {
        await expect(asTenant(UUIDUtilities.generate(), async () => await getFileService().store({
            store: 'archive',
            name: 'a.txt',
            mimeType: 'text/plain',
            data: Buffer.from('a')
        }))).rejects.toThrow('No file store is named "archive"');
    });
});