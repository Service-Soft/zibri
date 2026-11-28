import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ZibriBankPlugin } from '../bank/bank.plugin';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { createPostingBooks, PostingBooks, postingTestEntities, postingTestFileStores, postingTestProviders, rentOf, statementsFolder } from './bookkeeping-postings.cases';
import { inTenant, receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { Expense } from './models/expense.model';
import { ExpenseServiceInterface } from './services/expense-service.interface';

/**
 * What recording an expense costs, as calls on the store: every one of them a statement on postgres.
 */

const roundTrips: RoundTripCounter = new RoundTripCounter();

/**
 * How many calls recording an expense takes at most, once its tenant has posted before.
 */
const RECORDED_IN: number = 25;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: postingTestFileStores,
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...postingTestEntities],
                repositories: defaultTestServerRepositories,
                roundTrips
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriInvoicingPlugin(), new ZibriApprovalPlugin(), new ZibriBankPlugin()],
        providers: [...defaultTestServerProviders, ...postingTestProviders]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.inMemory.shutdown);

function expenses(): ExpenseServiceInterface {
    return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
}

describe('what recording an expense costs', () => {
    it('creates a draft in two calls, and records it in a fixed number of them, however many were recorded before', async () => {
        const books: PostingBooks = await createPostingBooks();
        // the first entry of a tenant creates the key its chain is signed with
        const first: Expense = await inTenant(books.tenantId, async () => await expenses().createExpense(rentOf(books)));
        await inTenant(books.tenantId, async () => await expenses().recordExpense(first.id));

        roundTrips.reset();
        const draft: Expense = await inTenant(books.tenantId, async () => await expenses().createExpense(rentOf(books, { documentNumber: 'R-78' })));
        const created: number = roundTrips.count;
        roundTrips.reset();
        await inTenant(books.tenantId, async () => await expenses().recordExpense(draft.id));

        expect(created).toBeLessThanOrEqual(2);
        // the calls themselves when there are more, which says which one came in
        expect(roundTrips.count <= RECORDED_IN ? RECORDED_IN : roundTrips.describe()).toBe(RECORDED_IN);
    });
});