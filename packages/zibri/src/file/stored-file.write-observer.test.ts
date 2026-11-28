import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { SoftDeleteEntity } from '../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../data-source/change-sets/soft-delete-repository';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { FileStore } from './decorators/file-store.decorator';
import { FileRecord } from './file-record.model';
import { FsFileStore } from './stores/fs.file-store';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `stored-file-observer-${UUIDUtilities.generate()}`);

@FileStore()
class ReceiptFileStore extends FsFileStore {
    constructor() {
        super('receipts', folder);
    }
}

@Entity({ allowOrphan: true })
class FiledExpense extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.file({ store: 'receipts', allowedMimeTypes: 'all', required: false })
    receipt?: string | null;

    @Property.array({ items: { type: 'file', store: 'receipts', allowedMimeTypes: 'all' }, required: false })
    attachments?: string[];
}

@Entity({ allowOrphan: true })
class BinnedExpense extends BaseTenantEntity(SoftDeleteEntity) {
    @Property.string()
    title!: string;

    @Property.file({ store: 'receipts', allowedMimeTypes: 'all', required: false })
    receipt?: string | null;
}

@Entity({ allowOrphan: true })
class ExpenseReport extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.oneToMany({ target: () => ExpenseReportLine, inverseSide: 'report', cascade: ['insert', 'update', 'remove'] })
    lines!: ExpenseReportLine[];
}

@Entity({ allowOrphan: true })
class ExpenseReportLine extends BaseTenantEntity() {
    @Property.file({ store: 'receipts', allowedMimeTypes: 'all' })
    receipt!: string;

    @Property.manyToOne({ target: () => ExpenseReport, joinColumn: 'reportId', inverseSide: 'lines' })
    report!: ExpenseReport;

    @Property.string({ format: 'uuid' })
    reportId!: string;
}

let server: StartedTestServer | undefined;
const tenant: string = UUIDUtilities.generate();

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, FileRecord, FiledExpense, BinnedExpense, ExpenseReport, ExpenseReportLine],
                repositories: defaultTestServerRepositories
            })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(folder);
}, TestTimeouts.inMemory.shutdown);

async function asTenant<T>(work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenant, work);
}

async function storeFile(name: string): Promise<string> {
    return (await asTenant(async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE)
        .store({ store: 'receipts', name, mimeType: 'application/pdf', data: Buffer.from(`%PDF ${name}`) }))).id;
}

async function isStored(id: string): Promise<boolean> {
    return await asTenant(async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(id)) != undefined;
}

async function waitUntilGone(ids: string[]): Promise<void> {
    await waitUntil(async () => (await Promise.all(ids.map(isStored))).every(stored => !stored));
}

function expenses(): Repository<FiledExpense> {
    return inject(repositoryTokenFor(FiledExpense));
}

async function createExpense(title: string): Promise<FiledExpense> {
    const receipt: string = await storeFile(`${title}.pdf`);
    const attachments: string[] = [await storeFile(`${title}-scan.pdf`), await storeFile(`${title}-note.pdf`)];
    return await asTenant(async () => await expenses().create({ title, receipt, attachments }));
}

describe('The repository of an entity keeping files in a file store', () => {
    it('deletes a file an update replaces or removes, and keeps the ones it leaves alone', async () => {
        const expense: FiledExpense = await createExpense('taxi');
        const replacement: string = await storeFile('taxi-corrected.pdf');

        await asTenant(async () => await expenses().updateById(expense.id, { receipt: replacement }));
        await waitUntilGone([expense.receipt ?? '']);
        expect(await isStored(replacement)).toBe(true);
        for (const id of expense.attachments ?? []) {
            expect(await isStored(id)).toBe(true);
        }

        await asTenant(async () => await expenses().updateById(expense.id, { title: 'taxi to the airport' }));
        expect(await isStored(replacement)).toBe(true);

        await asTenant(async () => await expenses().updateById(expense.id, { receipt: null }));
        await waitUntilGone([replacement]);
    });

    it('deletes the files of a row deleted by its id', async () => {
        const expense: FiledExpense = await createExpense('hotel');

        await asTenant(async () => await expenses().deleteById(expense.id));

        await waitUntilGone([expense.receipt ?? '', ...expense.attachments ?? []]);
    });

    it('deletes the files of the rows a filter deletes, and of those only', async () => {
        const removed: FiledExpense = await createExpense('dinner');
        const kept: FiledExpense = await createExpense('lunch');

        await asTenant(async () => await expenses().deleteAll({ title: 'dinner' }));

        await waitUntilGone([removed.receipt ?? '', ...removed.attachments ?? []]);
        for (const id of [kept.receipt ?? '', ...kept.attachments ?? []]) {
            expect(await isStored(id)).toBe(true);
        }
    });

    it('deletes the files an update of every matching row removes', async () => {
        const expense: FiledExpense = await createExpense('parking');

        await asTenant(async () => await expenses().updateAll({ title: 'parking' }, { attachments: [] }));

        await waitUntilGone(expense.attachments ?? []);
        expect(await isStored(expense.receipt ?? '')).toBe(true);
    });

    it('keeps the files of a delete that is rolled back', async () => {
        const expense: FiledExpense = await createExpense('flight');
        const transaction: Transaction = await expenses().dataSource.startTransaction();

        await asTenant(async () => await expenses().deleteById(expense.id, { transaction }));
        await transaction.rollback();

        for (const id of [expense.receipt ?? '', ...expense.attachments ?? []]) {
            expect(await isStored(id)).toBe(true);
        }
        expect(await asTenant(async () => await expenses().findById(expense.id))).toMatchObject({ receipt: expense.receipt });
    });

    it('keeps the files of a row soft deleted and restored, and deletes them with a hard delete', async () => {
        const repository: SoftDeleteRepository<BinnedExpense> = inject(repositoryTokenFor(BinnedExpense));
        const receipt: string = await storeFile('train.pdf');
        const expense: BinnedExpense = await asTenant(async () => await repository.create({ title: 'train', receipt }));

        await asTenant(async () => await repository.deleteById(expense.id));
        expect(await isStored(receipt)).toBe(true);
        await asTenant(async () => await repository.updateById(expense.id, { deleted: false }, { deleted: 'only' }));
        expect(await isStored(receipt)).toBe(true);

        await asTenant(async () => await repository.deleteById(expense.id));
        await asTenant(async () => await repository.deleteById(expense.id, { hardDelete: true }));
        await waitUntilGone([receipt]);
    });

    it('deletes the files of the rows a delete removes along with its row', async () => {
        const receipts: string[] = [await storeFile('line-1.pdf'), await storeFile('line-2.pdf')];
        const report: ExpenseReport = await asTenant(async () => await inject(repositoryTokenFor(ExpenseReport))
            .create({ title: 'November', lines: receipts.map(receipt => ({ receipt })) }));

        await asTenant(async () => await inject(repositoryTokenFor(ExpenseReport)).deleteById(report.id));

        await waitUntilGone(receipts);
    });
});