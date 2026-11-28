import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { FileReference as ContractFileReference } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { PartialClass } from '../entity/partial-class.model';
import { FileStore } from '../file/decorators/file-store.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { FileRecord } from '../file/file-record.model';
import { FsFileStore } from '../file/stores/fs.file-store';
import { MimeType } from '../http/mime-type.enum';
import { type LoggerInterface } from '../logging/logger.interface';
import { Response } from '../open-api/decorators/response.decorator';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { CrudController } from './models/crud-controller.model';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `router-work-tenant-${UUIDUtilities.generate()}`);

@FileStore()
class ReceiptFileStore extends FsFileStore {
    constructor() {
        super('receipts', folder);
    }
}

@Entity()
class WorkTenantExpense extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.file({ store: 'receipts', allowedMimeTypes: [MimeType.PDF], required: false })
    receipt?: string | null;
}

class WorkTenantExpenseData extends OmitClass(WorkTenantExpense, ['id', 'tenantId']) {}

// the controller whose download route the url of a receipt points to
@Controller('/expenses')
class ExpenseController extends CrudController(WorkTenantExpense, WorkTenantExpenseData, PartialClass(WorkTenantExpenseData)) {}

// what the support of an application reads every tenant's expenses through, in a request naming no tenant
@Controller('/support/expenses')
class SupportExpenseController {
    private get repository(): Repository<WorkTenantExpense> {
        return inject(repositoryTokenFor(WorkTenantExpense));
    }

    @Response.object(WorkTenantExpense)
    @Get('/:id')
    async findById(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<WorkTenantExpense> {
        const { tenantId } = await this.repository.findById(id, { acrossTenants: true });
        return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await this.repository.findById(id));
    }

    // two expenses, each read in its own tenant
    @Response.array(WorkTenantExpense)
    @Get('/:firstId/:secondId')
    async findPair(
        @Param.path('firstId', { type: 'string', format: 'uuid' })
        firstId: string,
        @Param.path('secondId', { type: 'string', format: 'uuid' })
        secondId: string
    ): Promise<WorkTenantExpense[]> {
        return await Promise.all([firstId, secondId].map(async id => await this.findById(id)));
    }
}

/**
 * An expense as the routes answer it.
 */
type ExpenseResponse = {
    id: string,
    title: string,
    receipt?: ContractFileReference | null
};

const PDF: Buffer = Buffer.from('%PDF-1.7 a receipt');

describe('the response of a request naming no tenant', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    const tenant: string = UUIDUtilities.generate();

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [ExpenseController, SupportExpenseController],
            fileStores: [ReceiptFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, WorkTenantExpense],
                    repositories: defaultTestServerRepositories
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(folder);
    }, TestTimeouts.inMemory.shutdown);

    it('is written in the tenant its handler did its work in, which the link of each file names', async () => {
        const form: FormData = new FormData();
        form.append('title', 'Train to the customer');
        form.append('receipt', new Blob([new Uint8Array(PDF)], { type: MimeType.PDF }), 'receipt-2026-11.pdf');
        const created: globalThis.Response = await fetch(`${baseUrl}/expenses`, { method: 'POST', body: form, headers: { 'x-tenant-id': tenant } });
        expect(created.status).toBe(200);
        const { id } = await created.json() as ExpenseResponse;

        const res: globalThis.Response = await fetch(`${baseUrl}/support/expenses/${id}`);

        expect(res.status).toBe(200);
        const expense: ExpenseResponse = await res.json() as ExpenseResponse;
        expect(expense.receipt).toStrictEqual({
            name: 'receipt-2026-11.pdf',
            mimeType: MimeType.PDF,
            size: PDF.length,
            url: `http://localhost:3000/expenses/${id}/files/receipt?x-tenant-id=${tenant}`
        });
        const link: URL = new URL(expense.receipt?.url ?? '');
        const download: globalThis.Response = await fetch(`${baseUrl}${link.pathname}${link.search}`);
        expect([download.status, Buffer.from(await download.arrayBuffer()).equals(PDF)]).toStrictEqual([200, true]);
    });

    it('is written for a handler that did its work in several tenants, while it links no file', async () => {
        const first: string = await createExpense(UUIDUtilities.generate(), 'Hotel at the trade fair', undefined);
        const second: string = await createExpense(UUIDUtilities.generate(), 'Taxi to the airport', undefined);

        const res: globalThis.Response = await fetch(`${baseUrl}/support/expenses/${first}/${second}`);

        expect(res.status).toBe(200);
        const expenses: ExpenseResponse[] = await res.json() as ExpenseResponse[];
        expect(expenses.map(e => [e.id, e.title, e.receipt])).toStrictEqual([
            [first, 'Hotel at the trade fair', undefined],
            [second, 'Taxi to the airport', undefined]
        ]);
    });

    it('fails naming the route for a handler that did its work in several tenants and links a file', async () => {
        const first: string = await createExpense(UUIDUtilities.generate(), 'Train to the customer', PDF);
        const second: string = await createExpense(UUIDUtilities.generate(), 'Taxi to the airport', undefined);
        const logged: jest.Spied<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

        const res: globalThis.Response = await fetch(`${baseUrl}/support/expenses/${first}/${second}`);

        expect(res.status).toBe(500);
        const error: unknown = logged.mock.calls.at(-1)?.[0];
        logged.mockRestore();
        expect(error).toBeInstanceOf(InternalError);
        expect(String(error)).toContain('The response of "SupportExpenseController.findPair" holds files to link');
        expect(String(error)).toContain('The response of a route working in several tenants cannot link files');
    });

    /**
     * Creates an expense in a tenant through its route.
     * @param tenantId - The tenant of the expense.
     * @param title - The title of the expense.
     * @param receipt - The pdf of its receipt, if it has one.
     * @returns The id of the expense.
     */
    async function createExpense(tenantId: string, title: string, receipt: Buffer | undefined): Promise<string> {
        const form: FormData = new FormData();
        form.append('title', title);
        if (receipt != undefined) {
            form.append('receipt', new Blob([new Uint8Array(receipt)], { type: MimeType.PDF }), 'receipt.pdf');
        }
        const created: globalThis.Response = await fetch(`${baseUrl}/expenses`, { method: 'POST', body: form, headers: { 'x-tenant-id': tenantId } });
        expect(created.status).toBe(200);
        return (await created.json() as ExpenseResponse).id;
    }
});
