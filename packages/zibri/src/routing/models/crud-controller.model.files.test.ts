import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { FileReference as ContractFileReference, PaginationResult } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Auth } from '../../auth/decorators/auth.decorator';
import { SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../data-source/change-sets/soft-delete-repository';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import { PartialClass } from '../../entity/partial-class.model';
import { FileStore } from '../../file/decorators/file-store.decorator';
import { FileRecord } from '../../file/file-record.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { MimeType } from '../../http/mime-type.enum';
import { OpenApiSchemaObject } from '../../open-api/open-api.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Controller } from '../decorators/controller.decorator';
import { CrudController } from './crud-controller.model';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `crud-controller-files-${UUIDUtilities.generate()}`);

@FileStore()
class ExpenseFileStore extends FsFileStore {
    constructor() {
        super('documents', folder);
    }
}

@Entity({ allowOrphan: true })
class CrudExpense extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.file({ store: 'documents', allowedMimeTypes: [MimeType.PDF, MimeType.PNG], maxSize: '1kb', required: false })
    receipt?: string | null;

    @Property.array({ items: { type: 'file', store: 'documents', allowedMimeTypes: 'all' }, required: false })
    attachments?: string[];
}

class CrudExpenseData extends OmitClass(CrudExpense, ['id', 'tenantId']) {}

class CrudExpenseUpdateData extends PartialClass(CrudExpenseData) {}

// orphans allowed, since the suite below boots servers without them
@Controller('/expenses', { allowOrphan: true })
class ExpenseController extends CrudController(CrudExpense, CrudExpenseData, CrudExpenseUpdateData) {}

@Entity({ allowOrphan: true })
class CrudSoftDeletedExpense extends BaseTenantEntity(SoftDeleteEntity) {
    @Property.string()
    title!: string;

    @Property.file({ store: 'documents', allowedMimeTypes: 'all', required: false })
    receipt?: string | null;
}

class CrudSoftDeletedExpenseData extends OmitClass(CrudSoftDeletedExpense, ['id', 'tenantId', 'changeSets', 'deleted', 'deletedWith']) {}

@Controller('/soft-deleted-expenses', { allowOrphan: true })
class SoftDeletedExpenseController extends CrudController(CrudSoftDeletedExpense, CrudSoftDeletedExpenseData, PartialClass(CrudSoftDeletedExpenseData)) {}

// the same rows, read by a caller who is logged in only
@Controller('/guarded-expenses', { allowOrphan: true })
class GuardedExpenseController extends CrudController(CrudExpense, CrudExpenseData, CrudExpenseUpdateData) {}
// on findById alone, as a decorator on a method of the controller would, which its download route takes as well
Auth.isLoggedIn()(GuardedExpenseController.prototype, 'findById', Object.getOwnPropertyDescriptor(GuardedExpenseController.prototype, 'findById') ?? {});

/**
 * An expense as the routes answer it.
 */
type ExpenseResponse = {
    id: string,
    title: string,
    receipt?: ContractFileReference | null,
    attachments?: ContractFileReference[]
};

/**
 * What a schema of the OpenAPI document holds by its content type.
 */
type DocumentedContent = Record<string, { schema: OpenApiSchemaObject }>;

/**
 * The part of the OpenAPI document the suite reads: the bodies and responses of the operations.
 */
type DocumentedPaths = {
    paths: Record<string, Record<string, { requestBody?: { content: DocumentedContent }, responses: Record<string, { content: DocumentedContent }> }>>
};

const PDF: Buffer = Buffer.from('%PDF-1.7 a receipt');
const PNG: Buffer = Buffer.from('\u0089PNG a scan of the receipt');

describe('CrudController of an entity keeping its files in a file store', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    const tenant: string = UUIDUtilities.generate();

    beforeAll(async () => {
        server = await startTestServer({
            version: '1.0.0',
            controllers: [ExpenseController, GuardedExpenseController, SoftDeletedExpenseController],
            fileStores: [ExpenseFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, CrudExpense, CrudSoftDeletedExpense],
                    repositories: defaultTestServerRepositories,
                    // the suites boot several servers in one process
                    allowOrphan: true
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(folder);
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Sends a request of the tenant.
     * @param path - The route.
     * @param init - What else the request carries.
     * @returns The response.
     */
    async function send(path: string, init: RequestInit = {}): Promise<Response> {
        return await fetch(`${baseUrl}${path}`, { ...init, headers: { 'x-tenant-id': tenant } });
    }

    /**
     * Creates an expense with a receipt and two attachments.
     * @returns The expense as the route answers it.
     */
    async function createExpense(): Promise<ExpenseResponse> {
        const form: FormData = new FormData();
        form.append('title', 'Train to the customer');
        form.append('receipt', new Blob([new Uint8Array(PDF)], { type: MimeType.PDF }), 'receipt-2026-11.pdf');
        form.append('attachments', new Blob([new Uint8Array(PNG)], { type: MimeType.PNG }), 'scan.png');
        form.append('attachments', new Blob(['a note'], { type: 'text/plain' }), 'note.txt');
        const res: Response = await send('/expenses', { method: 'POST', body: form });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-return
        return await res.json();
    }

    /**
     * Downloads what a url of a reference points to, through the address the server listens at.
     * @param url - The url of the reference.
     * @returns The response.
     */
    async function download(url: string | null | undefined): Promise<Response> {
        const target: URL = new URL(url ?? '');
        return await fetch(`${baseUrl}${target.pathname}${target.search}`);
    }

    async function findRecord(id: string): Promise<FileRecord | undefined> {
        return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(id));
    }

    async function findRecordIds(expenseId: string): Promise<string[]> {
        const row: CrudExpense = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenant,
            async () => await inject(ExpenseController).findById(expenseId)
        );
        return [...row.receipt == undefined ? [] : [row.receipt], ...row.attachments ?? []];
    }

    it('creates a row from a multipart body, and answers each file as a reference with the url of its download', async () => {
        const created: ExpenseResponse = await createExpense();

        expect(created.receipt).toEqual({
            name: 'receipt-2026-11.pdf',
            mimeType: MimeType.PDF,
            size: PDF.length,
            url: `http://localhost:3000/expenses/${created.id}/files/receipt?x-tenant-id=${tenant}`
        });
        expect(created.attachments).toEqual([
            { name: 'scan.png', mimeType: MimeType.PNG, size: PNG.length, url: `http://localhost:3000/expenses/${created.id}/files/attachments.0?x-tenant-id=${tenant}` },
            { name: 'note.txt', mimeType: 'text/plain', size: 6, url: `http://localhost:3000/expenses/${created.id}/files/attachments.1?x-tenant-id=${tenant}` }
        ]);
        // the column holds the id of the file's row, whose bytes are in the store
        const ids: string[] = await findRecordIds(created.id);
        expect(ids).toHaveLength(3);
        expect(await findRecord(ids[0] ?? '')).toMatchObject({ name: 'receipt-2026-11.pdf', storeName: 'documents' });
        // the uploads are gone once they are stored
        const uploads: FsPath = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);
        const left: string[] = await FsUtilities.exists(uploads) ? (await FsUtilities.readdir(uploads)).map(e => e.name) : [];
        expect(left.filter(name => name.startsWith('temp-'))).toEqual([]);
    });

    it('answers the references when the row is read, alone and in a page', async () => {
        const created: ExpenseResponse = await createExpense();

        const read: ExpenseResponse = await (await send(`/expenses/${created.id}`)).json() as ExpenseResponse;
        expect(read).toEqual(created);
        const page: PaginationResult<ExpenseResponse> = await (await send('/expenses?page=1&limit=100'))
            .json() as PaginationResult<ExpenseResponse>;
        expect(page.items.find(item => item.id === created.id)).toEqual(created);
    });

    it('serves the bytes of a file and of an item of an array at their urls, as a download under their name', async () => {
        const created: ExpenseResponse = await createExpense();

        const receipt: Response = await download(created.receipt?.url);
        expect(receipt.status).toBe(200);
        expect(receipt.headers.get('content-type')).toBe(MimeType.PDF);
        expect(receipt.headers.get('content-disposition')).toContain('attachment');
        expect(receipt.headers.get('content-disposition')).toContain('receipt-2026-11.pdf');
        expect(Buffer.from(await receipt.arrayBuffer()).equals(PDF)).toBe(true);

        const scan: Response = await download(created.attachments?.[0]?.url);
        expect(scan.headers.get('content-type')).toBe(MimeType.PNG);
        expect(Buffer.from(await scan.arrayBuffer()).equals(PNG)).toBe(true);

        expect((await send(`/expenses/${created.id}/files/attachments.7`)).status).toBe(404);
        expect((await send(`/expenses/${created.id}/files/title`)).status).toBe(404);
        expect((await send(`/expenses/${UUIDUtilities.generate()}/files/receipt`)).status).toBe(404);
    });

    it('refuses the download to a caller the controller refuses the row', async () => {
        const created: ExpenseResponse = await createExpense();

        expect((await send(`/guarded-expenses/${created.id}`)).status).toBe(401);
        expect((await send(`/guarded-expenses/${created.id}/files/receipt`)).status).toBe(401);
        // a row of another tenant is not found, its files neither
        expect((await fetch(`${baseUrl}/expenses/${created.id}/files/receipt?x-tenant-id=${UUIDUtilities.generate()}`)).status).toBe(404);
    });

    it('replaces a file sent anew and keeps one left out, deleting the replaced one', async () => {
        const created: ExpenseResponse = await createExpense();
        const [oldReceipt = '', ...oldAttachments] = await findRecordIds(created.id);

        const form: FormData = new FormData();
        form.append('receipt', new Blob([new Uint8Array(PNG)], { type: MimeType.PNG }), 'receipt-photo.png');
        const res: Response = await send(`/expenses/${created.id}`, { method: 'PATCH', body: form });

        expect(res.status).toBe(200);
        const updated: ExpenseResponse = await res.json() as ExpenseResponse;
        expect(updated.receipt).toMatchObject({ name: 'receipt-photo.png', mimeType: MimeType.PNG, size: PNG.length });
        expect(updated.attachments).toEqual(created.attachments);
        expect(updated.title).toBe('Train to the customer');
        expect(await findRecord(oldReceipt)).toBeUndefined();
        expect((await findRecordIds(created.id)).slice(1)).toEqual(oldAttachments);
        expect(Buffer.from(await (await download(updated.receipt?.url)).arrayBuffer()).equals(PNG)).toBe(true);
    });

    it('removes the files of an empty field, deleting them', async () => {
        const created: ExpenseResponse = await createExpense();
        const ids: string[] = await findRecordIds(created.id);

        const form: FormData = new FormData();
        form.append('receipt', '');
        form.append('attachments', '');
        const res: Response = await send(`/expenses/${created.id}`, { method: 'PATCH', body: form });

        expect(res.status).toBe(200);
        const updated: ExpenseResponse = await res.json() as ExpenseResponse;
        expect(updated.receipt).toBeNull();
        expect(updated.attachments).toEqual([]);
        for (const id of ids) {
            expect(await findRecord(id)).toBeUndefined();
        }
        expect((await send(`/expenses/${created.id}/files/receipt`)).status).toBe(404);
    });

    it('refuses a file of a type the property does not allow, storing nothing', async () => {
        const form: FormData = new FormData();
        form.append('title', 'Dinner');
        form.append('receipt', new Blob(['plain'], { type: 'text/plain' }), 'receipt.txt');

        expect((await send('/expenses', { method: 'POST', body: form })).status).toBe(400);
    });

    it('deletes the files of a row deleted', async () => {
        const created: ExpenseResponse = await createExpense();
        const ids: string[] = await findRecordIds(created.id);

        expect((await send(`/expenses/${created.id}`, { method: 'DELETE' })).status).toBe(204);

        for (const id of ids) {
            expect(await findRecord(id)).toBeUndefined();
        }
    });

    it('keeps the files of a row soft deleted, which its restore serves again', async () => {
        const form: FormData = new FormData();
        form.append('title', 'Hotel');
        form.append('receipt', new Blob([new Uint8Array(PDF)], { type: MimeType.PDF }), 'hotel.pdf');
        const created: ExpenseResponse = await (await send('/soft-deleted-expenses', { method: 'POST', body: form })).json() as ExpenseResponse;
        const repository: SoftDeleteRepository<CrudSoftDeletedExpense> = inject(repositoryTokenFor(CrudSoftDeletedExpense));
        const receipt: string | null | undefined = (await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenant, async () => await repository.findById(created.id))).receipt;

        expect((await send(`/soft-deleted-expenses/${created.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(await findRecord(receipt ?? '')).toMatchObject({ name: 'hotel.pdf' });
        expect((await download(created.receipt?.url)).status).toBe(404);

        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenant, async () => await repository.updateById(created.id, { deleted: false }, { deleted: 'only' }));
        const restored: Response = await download(created.receipt?.url);
        expect(restored.status).toBe(200);
        expect(Buffer.from(await restored.arrayBuffer()).equals(PDF)).toBe(true);
    });

    it('documents a file as uploaded bytes and answered as a reference', async () => {
        const res: Response = await fetch(`${baseUrl}/explorer/spec/1.0.0`);
        expect(res.status).toBe(200);
        const spec: DocumentedPaths = await res.json() as DocumentedPaths;

        const body: OpenApiSchemaObject | undefined = spec.paths['/expenses/']?.['post']?.requestBody?.content[MimeType.FORM_DATA]?.schema;
        const answered: OpenApiSchemaObject | undefined = spec.paths['/expenses/']?.['post']?.responses['default']?.content[MimeType.JSON]?.schema;
        expect(body?.properties?.['receipt']).toMatchObject({ type: ['string', 'null'], format: 'binary' });
        expect(answered?.properties?.['receipt']).toMatchObject({
            type: ['object', 'null'],
            properties: { name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'integer' } }
        });
        expect(answered?.properties?.['attachments']).toMatchObject({ type: ['array', 'null'], items: { type: 'object' } });
        expect(spec.paths['/expenses/{id}/files/{file}']?.['get']).toBeDefined();
    });
});

class ExpenseLine {
    @Property.file({ store: 'documents', allowedMimeTypes: 'all' })
    receipt!: string;
}

@Entity({ allowOrphan: true })
class NestedFileExpense extends BaseTenantEntity() {
    @Property.object({ cls: () => ExpenseLine })
    line!: ExpenseLine;
}

// a store no file store of this process is named
@Entity({ allowOrphan: true })
class UnregisteredStoreExpense extends BaseTenantEntity() {
    @Property.file({ store: 'archive', allowedMimeTypes: 'all' })
    receipt!: string;
}

@Entity({ allowOrphan: true })
class MixedExpense extends BaseTenantEntity() {
    @Property.file({ store: 'documents', allowedMimeTypes: 'all' })
    receipt!: string;

    @Property.file({ allowedMimeTypes: [MimeType.PNG] })
    photo!: Buffer;
}

class MixedExpenseData extends OmitClass(MixedExpense, ['id', 'tenantId']) {}

@Controller('/mixed-expenses', { allowOrphan: true })
class MixedExpenseController extends CrudController(MixedExpense, MixedExpenseData, PartialClass(MixedExpenseData)) {}

describe('A file kept in a file store', () => {
    it('is refused inside an object, at startup', async () => {
        await expect(startTestServer({
            fileStores: [ExpenseFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, NestedFileExpense],
                    repositories: defaultTestServerRepositories,
                    // the suites boot several servers in one process
                    allowOrphan: true
                })
            ]
        })).rejects.toThrow('NestedFileExpense.line.receipt: A file kept in a file store needs to be a property of the entity');
    }, TestTimeouts.inMemory.start);

    it('is refused in a store that is neither registered nor one a tenant may configure, at startup', async () => {
        await expect(startTestServer({
            fileStores: [ExpenseFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, UnregisteredStoreExpense],
                    repositories: defaultTestServerRepositories,
                    // the suites boot several servers in one process
                    allowOrphan: true
                })
            ]
        })).rejects.toThrow('UnregisteredStoreExpense.receipt keeps its files in the file store "archive", which is not registered.');
    }, TestTimeouts.inMemory.start);

    it('is refused beside a file kept in the column that a CrudController would take as an upload, at startup', async () => {
        await expect(startTestServer({
            controllers: [MixedExpenseController],
            fileStores: [ExpenseFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, MixedExpense],
                    repositories: defaultTestServerRepositories,
                    // the suites boot several servers in one process
                    allowOrphan: true
                })
            ]
        })).rejects.toThrow('MixedExpenseController: MixedExpenseData.photo is a file kept in the column of MixedExpense');
    }, TestTimeouts.inMemory.start);
});

/**
 * The name of the store the receipts of a team are kept in, which the application provides.
 */
const RECEIPT_STORE: InjectionToken<string> = new InjectionToken<string>('test.receipt_store');

const receiptsFolder: FsPath = FsUtilities.getPath(testFileFolder, `crud-controller-receipts-${UUIDUtilities.generate()}`);

@FileStore()
class ReceiptFileStore extends FsFileStore {
    constructor() {
        super('receipts', receiptsFolder);
    }
}

@Entity({ allowOrphan: true })
class TokenStoreExpense extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.file({ store: RECEIPT_STORE, allowedMimeTypes: 'all' })
    receipt!: string;
}

class TokenStoreExpenseData extends OmitClass(TokenStoreExpense, ['id', 'tenantId']) {}

@Controller('/token-store-expenses', { allowOrphan: true })
class TokenStoreExpenseController extends CrudController(TokenStoreExpense, TokenStoreExpenseData, PartialClass(TokenStoreExpenseData)) {}

describe('A file property naming its store by a DI token', () => {
    /**
     * Starts a server whose token names the given store.
     * @param storeName - What the token provides.
     * @returns The server.
     */
    async function startWithStore(storeName: string): Promise<StartedTestServer> {
        return await startTestServer({
            controllers: [TokenStoreExpenseController],
            fileStores: [ExpenseFileStore, ReceiptFileStore],
            providers: [...defaultTestServerProviders, defineProvider({ token: RECEIPT_STORE, useValue: storeName })],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, TokenStoreExpense],
                    repositories: defaultTestServerRepositories,
                    // the suites boot several servers in one process
                    allowOrphan: true
                })
            ]
        });
    }

    afterAll(async () => {
        await FsUtilities.rm(receiptsFolder);
    });

    it('keeps its files in the store the token names', async () => {
        const server: StartedTestServer = await startWithStore('receipts');
        try {
            const tenant: string = UUIDUtilities.generate();
            const form: FormData = new FormData();
            form.append('title', 'Train to the customer');
            form.append('receipt', new Blob([new Uint8Array(PDF)], { type: MimeType.PDF }), 'receipt.pdf');
            const res: Response = await fetch(`${await server.start()}/token-store-expenses`, { method: 'POST', body: form, headers: { 'x-tenant-id': tenant } });
            expect(res.status).toBe(200);

            const records: FileRecord[] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
                .runAs(tenant, async () => await inject<Repository<FileRecord>>(repositoryTokenFor(FileRecord)).findAll());
            expect(records.map(r => [r.name, r.storeName])).toEqual([['receipt.pdf', 'receipts']]);
            const read: Buffer = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
                .runAs(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(records[0]?.id ?? ''));
            expect(read).toEqual(PDF);
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);

    it('is refused at startup when the token names a store that is not registered', async () => {
        await expect(startWithStore('archive')).rejects.toThrow(
            'TokenStoreExpense.receipt keeps its files in the file store "archive", named by test.receipt_store, which is not registered.'
        );
    }, TestTimeouts.inMemory.start);
});