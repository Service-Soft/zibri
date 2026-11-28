import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, inMemoryStoreFor } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { defineProvider, DiProvider } from '../../../di/models/di-provider.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import {
    bookkeepingTestConformances,
    bookkeepingTestEntities,
    bookkeepingTestOptions,
    inTenant,
    journal,
    ReceiptsFileStore,
    receiptsFolder
} from '../bookkeeping.cases';
import { ZibriBookkeepingPlugin } from '../bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingCompany } from './bookkeeping-company.model';
import { BookkeepingSettings } from './bookkeeping-settings.model';

/**
 * The company of an application keeping the tax id of the company encrypted.
 */
class EncryptedTaxIdCompany extends BookkeepingCompany {
    @Property.string({ required: false, encryption: true })
    taxId?: string | null;
}

const TAX_ID: string = 'DE123456789';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...bookkeepingTestEntities],
    repositories: defaultTestServerRepositories
});

/**
 * Starts an application keeping books, with the given company model, or the default one.
 * @param companyModel - The company model it registers, none for the default.
 * @returns The started application.
 */
async function start(companyModel: Newable<BookkeepingCompany> | undefined): Promise<StartedTestServer> {
    const providers: DiProvider<unknown>[] = companyModel == undefined
        ? []
        : [defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL, useValue: companyModel })];
    return await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [dataSourceClass],
        plugins: [new ZibriBookkeepingPlugin()],
        providers: [...defaultTestServerProviders, bookkeepingTestOptions, bookkeepingTestConformances, ...providers]
    });
}

/**
 * Starts the books of a new tenant with a company of no legal form.
 * @param company - The company.
 * @returns The settings.
 */
async function createSettings(company: BookkeepingCompany): Promise<BookkeepingSettings> {
    return await inTenant(UUIDUtilities.generate(), async () => await journal().createSettings({ currency: 'EUR', legalForms: [], company }));
}

// the applications run one after the other in the same process, as the suites of a test run do
describe('the company of the bookkeeping settings, in a process that ran an application with another company model before', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        const before: StartedTestServer = await start(undefined);
        await createSettings({ name: 'Acme' });
        await before.shutdown();
        server = await start(EncryptedTaxIdCompany);
    }, TestTimeouts.inMemory.start * 2);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(receiptsFolder);
    }, TestTimeouts.inMemory.shutdown);

    it('stores what the company model of this application encrypts encrypted', async () => {
        const company: EncryptedTaxIdCompany = { name: 'Acme', taxId: TAX_ID };

        const settings: BookkeepingSettings = await createSettings(company);

        const stored: unknown = inMemoryStoreFor(dataSourceClass)
            .readRow(MetadataUtilities.getEntityMetadata(BookkeepingSettings)?.tableName ?? '', settings.id)?.['company'];
        expect([typeof stored, String(stored).includes(TAX_ID)]).toStrictEqual(['string', false]);
    });
});
