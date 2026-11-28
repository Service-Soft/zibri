import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { FileReference as ContractFileReference } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { runApplicationClockAhead } from '../__testing__/run-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { BaseChainedEntity } from '../data-source/chain/base-chained-entity.model';
import { ChainGap } from '../data-source/chain/chain-gap.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { PartialClass } from '../entity/partial-class.model';
import { FileStore } from '../file/decorators/file-store.decorator';
import { FileRecord } from '../file/file-record.model';
import { FsFileStore } from '../file/stores/fs.file-store';
import { MimeType } from '../http/mime-type.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { CrudController } from '../routing/models/crud-controller.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { ArchivedReceipt, describeArchive, SCAN } from './archive.cases';
import { BaseArchivedEntity } from './base-archived-entity.model';
import { Archive } from './decorators/archive.decorator';

const documentsFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-documents-${UUIDUtilities.generate()}`);
const offsiteFolder: FsPath = FsUtilities.getPath(testFileFolder, `archive-offsite-${UUIDUtilities.generate()}`);

@FileStore()
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', documentsFolder);
    }
}

@FileStore()
class OffsiteFileStore extends FsFileStore {
    constructor() {
        super('offsite', offsiteFolder);
    }
}

class ArchivedReceiptCreateData extends OmitClass(ArchivedReceipt, ['id', 'tenantId', 'chainSequence', 'chainHash', 'archivedFiles', 'retainUntil']) {}

class ArchivedReceiptUpdateData extends PartialClass(ArchivedReceiptCreateData) {}

@Controller('/archived-receipts', { allowOrphan: true })
class ArchivedReceiptController extends CrudController(ArchivedReceipt, ArchivedReceiptCreateData, ArchivedReceiptUpdateData) {}

/**
 * A note of a team, kept 30 days from when it was written.
 */
@Entity({ allowOrphan: true, chained: true })
@Archive({ retention: { days: 30 }, from: 'date' })
class ArchivedNote extends BaseArchivedEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    text!: string;
}

/**
 * A chained entity of no archive, which stays append only.
 */
@Entity({ allowOrphan: true, chained: true })
class PlainChainedNote extends BaseChainedEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    text!: string;
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [ArchivedReceiptController],
        fileStores: [DocumentFileStore, OffsiteFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, FileRecord, ChainGap, ArchivedReceipt, ArchivedNote, PlainChainedNote],
                repositories: defaultTestServerRepositories,
                allowOrphan: true
            })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterEach(() => {
    jest.useRealTimers();
});

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(documentsFolder);
    await FsUtilities.rm(offsiteFolder);
}, TestTimeouts.inMemory.shutdown);

describeArchive('the in memory data source', ArchivedReceipt, () => inject(DocumentFileStore));

async function asTenant<T>(tenant: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenant, work);
}

async function createReceipt(tenant: string): Promise<ArchivedReceipt> {
    return await asTenant(tenant, async () => {
        const scan: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE)
            .store({ store: 'documents', name: 'taxi.pdf', mimeType: MimeType.PDF, data: SCAN });
        return await inject(repositoryTokenFor(ArchivedReceipt)).create({ title: 'Taxi to the customer', issuedAt: new Date(), scan: scan.id });
    });
}

async function send(tenant: string, path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, { ...init, headers: { 'x-tenant-id': tenant } });
}

describe('an archived entity counting from its date', () => {
    it('counts the retention from when the row was created with from: \'date\' and no date property', async () => {
        const tenant: string = UUIDUtilities.generate();
        const before: number = Date.now();
        const note: ArchivedNote = await asTenant(tenant, async () => await inject(repositoryTokenFor(ArchivedNote)).create({ text: 'approved' }));

        expect(note.retainUntil.getTime()).toBeGreaterThanOrEqual(before + (30 * Ms.DAY));
        expect(note.retainUntil.getTime()).toBeLessThanOrEqual(Date.now() + (30 * Ms.DAY));
        expect(note.archivedFiles).toEqual([]);
    });
});

describe('the copies of the files of an archived row', () => {
    it('are read in place of a file whose bytes changed, and served so by the download route', async () => {
        const tenant: string = UUIDUtilities.generate();
        const receipt: ArchivedReceipt = await createReceipt(tenant);
        const record: FileRecord | undefined = await asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(receipt.scan ?? ''));

        await inject(DocumentFileStore).put(record?.key ?? '', Readable.from([Buffer.from('%PDF-1.7 tampered')]));

        await expect(asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(receipt.scan ?? '')))
            .rejects.toThrow('does not match the SHA-256');
        const read: Buffer = await asTenant(tenant, async () => await buffer(await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(receipt, receipt.scan ?? '')));
        expect(read).toEqual(SCAN);
        const res: Response = await send(tenant, `/archived-receipts/${receipt.id}/files/scan`);
        expect(res.status).toBe(200);
        expect(Buffer.from(await res.arrayBuffer())).toEqual(SCAN);
    });
});

describe('an archived entity, through its CrudController', () => {
    it('creates a row with its file, refuses to change it, and deletes it only once its retention ended', async () => {
        const tenant: string = UUIDUtilities.generate();
        const form: FormData = new FormData();
        form.append('title', 'Train to the customer');
        form.append('issuedAt', new Date().toISOString());
        form.append('scan', new Blob([new Uint8Array(SCAN)], { type: MimeType.PDF }), 'train.pdf');
        const created: Response = await send(tenant, '/archived-receipts', { method: 'POST', body: form });
        expect(created.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const receipt: { id: string, retainUntil: string, scan: ContractFileReference } = await created.json();
        expect(receipt.scan).toMatchObject({ name: 'train.pdf', size: SCAN.length });

        const patch: FormData = new FormData();
        patch.append('title', 'Taxi');
        const patched: Response = await send(tenant, `/archived-receipts/${receipt.id}`, { method: 'PATCH', body: patch });
        expect(patched.status).toBe(409);
        const deleted: Response = await send(tenant, `/archived-receipts/${receipt.id}`, { method: 'DELETE' });
        expect(deleted.status).toBe(409);
        expect(await deleted.text()).toContain(`is archived until ${receipt.retainUntil}`);

        runApplicationClockAhead(10 * 366 * Ms.DAY);
        expect((await send(tenant, `/archived-receipts/${receipt.id}`, { method: 'DELETE' })).ok).toBe(true);
        expect((await send(tenant, `/archived-receipts/${receipt.id}`)).status).toBe(404);
    });
});

describe('an entity that is not archived', () => {
    it('stays append only, refusing a delete as a mistake of the code', async () => {
        const tenant: string = UUIDUtilities.generate();
        const notes: Repository<PlainChainedNote> = inject(repositoryTokenFor(PlainChainedNote));
        const note: PlainChainedNote = await asTenant(tenant, async () => await notes.create({ text: 'approved' }));

        await expect(asTenant(tenant, async () => await notes.deleteById(note.id))).rejects.toThrow('are append only, and are only created');
        await expect(asTenant(tenant, async () => await notes.updateById(note.id, { text: 'rejected' }))).rejects.toThrow('are append only');
    });
});