import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { type DiProvider, defineProvider } from '../../../di/models/di-provider.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { type Newable } from '../../../types/newable.type';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { bookkeepingTestEntities, ReceiptsFileStore, receiptsFolder } from '../bookkeeping.cases';
import { ZibriBookkeepingPlugin } from '../bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingCompany } from '../models/bookkeeping-company.model';
import { eBilanzTestEntities, eBilanzTestProviders } from './e-bilanz.cases';
import { ZibriEBilanzPlugin } from './e-bilanz.plugin';
import { GermanBookkeepingCompany } from './models/german-bookkeeping-company.model';

/**
 * A company of another law, which knows nothing of the GCD module.
 */
class AustrianBookkeepingCompany extends BookkeepingCompany {

    @Property.string({ required: false })
    companyRegisterNumber?: string | null;
}

/**
 * The German company with what an application adds of its own.
 */
class AppBookkeepingCompany extends GermanBookkeepingCompany {

    @Property.string({ required: false })
    customerNumber?: string | null;
}

/**
 * Starts an application with the E-Bilanz, and the company model given, none for the default of the bookkeeping plugin.
 * @param companyModel - The company model.
 * @returns The started server, or the failure.
 */
async function start(companyModel: Newable<BookkeepingCompany> | undefined): Promise<StartedTestServer> {
    const providers: DiProvider<unknown>[] = eBilanzTestProviders.filter(p => p.token !== ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL);
    return await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities, ...eBilanzTestEntities],
                repositories: defaultTestServerRepositories,
                // each test declares one, which the application of the other one leaves out
                allowOrphan: true
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriEBilanzPlugin()],
        providers: [
            ...defaultTestServerProviders,
            ...providers,
            ...companyModel == undefined ? [] : [defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL, useValue: companyModel })]
        ]
    });
}

describe('starting the E-Bilanz plugin', () => {
    it('refuses an application whose bookkeeping settings keep the generic company', async () => {
        await expect(start(undefined)).rejects.toThrow(
            'ZibriEBilanzPlugin needs GermanBookkeepingCompany, or a class extending it, in ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL, and got BookkeepingCompany.'
        );
    }, TestTimeouts.inMemory.start);

    it('refuses a company model of another law', async () => {
        await expect(start(AustrianBookkeepingCompany)).rejects.toThrow('and got AustrianBookkeepingCompany.');
    }, TestTimeouts.inMemory.start);

    it('starts with a company model extending the German company', async () => {
        const server: StartedTestServer = await start(AppBookkeepingCompany);
        expect(inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL)).toBe(AppBookkeepingCompany);
        await server.shutdown();
        await FsUtilities.rm(receiptsFolder);
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);
});