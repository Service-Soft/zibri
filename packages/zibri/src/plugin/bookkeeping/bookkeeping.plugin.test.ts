import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { missingEntityPattern } from '../../__testing__/missing-entity-pattern.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ChainGap } from '../../data-source/chain/chain-gap.model';
import { defineProvider } from '../../di/models/di-provider.model';
import { FileRecord } from '../../file/file-record.model';
import { bookkeepingTestEntities, bookkeepingTestOptions, ReceiptsFileStore } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { BookkeepingAccount } from './models/bookkeeping-account.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';

describe('starting the bookkeeping plugin', () => {
    it('refuses an application without its entities, and names them', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            fileStores: [ReceiptsFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, FileRecord, ChainGap, BookkeepingSettings, BookkeepingAccount],
                    repositories: defaultTestServerRepositories,
                    // each test declares one, which the application of the other one leaves out
                    allowOrphan: true
                })
            ],
            plugins: [new ZibriBookkeepingPlugin()],
            providers: [...defaultTestServerProviders, bookkeepingTestOptions]
        });

        await expect(start).rejects.toThrow(missingEntityPattern('FiscalYear', 'ZibriBookkeepingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('JournalEntry', 'ZibriBookkeepingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('JournalEntryLine', 'ZibriBookkeepingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('PostingRuleSet', 'ZibriBookkeepingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('Expense', 'ZibriBookkeepingPlugin'));
    }, TestTimeouts.inMemory.start);

    it('refuses an application that does not say what a tenant without books does', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            fileStores: [ReceiptsFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, ...bookkeepingTestEntities],
                    repositories: defaultTestServerRepositories,
                    // each test declares one, which the application of the other one leaves out
                    allowOrphan: true
                })
            ],
            plugins: [new ZibriBookkeepingPlugin()],
            providers: defaultTestServerProviders
        });

        await expect(start).rejects.toThrow(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT.toString());
    }, TestTimeouts.inMemory.start);

    it('refuses a retention that is not a whole number of years, months and days', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            fileStores: [ReceiptsFileStore],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, ...bookkeepingTestEntities],
                    repositories: defaultTestServerRepositories,
                    // each test declares one, which the application of the other one leaves out
                    allowOrphan: true
                })
            ],
            plugins: [new ZibriBookkeepingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useValue: { tenantsWithoutBooks: 'post-nothing', retention: { years: 0 } }
                })
            ]
        });

        await expect(start).rejects.toThrow('The retention of an archive needs to be a whole number of years, months and days');
    }, TestTimeouts.inMemory.start);
});
