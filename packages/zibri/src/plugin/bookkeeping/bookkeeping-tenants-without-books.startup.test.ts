/* eslint-disable cspell/spellchecker */
import { afterAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { bookkeepingTestEntities, day, inTenant, journal, ReceiptsFileStore, receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { type BookkeepingCompany } from './models/bookkeeping-company.model';
import { type BookkeepingPluginOptionsInput } from './models/bookkeeping-plugin-options-input.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';
import { type NewBookkeepingSettings } from './models/new-bookkeeping-settings.model';
import { type TenantsWithoutBooksOptions } from './models/tenants-without-books.type';

// a file of its own, as a case starts the application more than once, on rows that outlive each start. In memory, as
// nothing here depends on where the rows are stored

/**
 * The company of the books of the GmbHs of the cases, with its register.
 */
const COMPANY: BookkeepingCompany = { name: 'Acme GmbH', seat: 'Berlin', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B' };

/**
 * The settings a tenant is created with: in EUR, as a GmbH, unless its name asks for something else.
 * @param tenant - The tenant.
 * @param transaction - The transaction it is created in.
 * @returns The settings.
 */
// eslint-disable-next-line typescript/require-await
async function resolveSettingsOf(tenant: BaseTenantDefinition, transaction: Transaction): Promise<NewBookkeepingSettings> {
    expect(transaction).toBeDefined();
    if (tenant.name === 'Refused') {
        throw new Error('The tenant Refused keeps no books here.');
    }
    // a time of day, which no legal form is valid from
    const validFrom: Date = tenant.name === 'Invalid' ? new Date('2020-01-01T12:00:00.000Z') : day('2020-01-01');
    // a GmbH without its register, which its conformances refuse
    return { currency: 'EUR', legalForms: [{ legalForm: 'GmbH', validFrom }], company: tenant.name === 'Unregistered' ? null : COMPANY };
}

const never: TenantsWithoutBooksOptions = { tenantsWithoutBooks: 'never', resolveSettingsOf };

/**
 * A data source whose rows outlive every application started on it, as those of a database do.
 * @param tenantEntities - The entity of the tenants, if any. `TestTenant` by default.
 * @returns The class of the data source.
 */
function createDataSource(tenantEntities: Newable<TestTenant>[] = [TestTenant]): Newable<InMemoryDataSource> {
    return createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ...bookkeepingTestEntities, ...tenantEntities],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
}

/**
 * Starts an application on a data source, and stops it after the work.
 * @param dataSource - The data source.
 * @param options - What a tenant without books does.
 * @param work - What to do while it runs.
 */
async function withServer(
    dataSource: Newable<InMemoryDataSource>,
    options: TenantsWithoutBooksOptions,
    work: () => Promise<void> = () => Promise.resolve()
): Promise<void> {
    const server: StartedTestServer = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [dataSource],
        plugins: [new ZibriBookkeepingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: options }),
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example-company.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                taxNumber: '123/456/78910',
                vatNumber: 'DE123456789',
                ceo: 'James Smith',
                iban: 'DE75512108001245126199',
                bic: 'ABCDDEFFXXX'
            }))
        ]
    });
    try {
        await server.start();
        await work();
    }
    finally {
        await server.shutdown();
    }
}

function tenants(): Repository<TestTenant> {
    return inject(repositoryTokenFor(TestTenant));
}

/**
 * Creates a tenant in an application that posts nothing of a tenant without books.
 * @param name - Its name.
 * @param keepsBooks - Whether it has bookkeeping settings.
 * @param deactivatedAt - When it was deactivated, null for a tenant that is not.
 * @returns Its id.
 */
async function createTenant(name: string, keepsBooks: boolean, deactivatedAt: Date | null = null): Promise<string> {
    const tenant: TestTenant = await tenants().create({ name, deactivatedAt });
    if (keepsBooks) {
        await inTenant(tenant.id, async () => await journal().createSettings({
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }],
            company: COMPANY
        }));
    }
    return tenant.id;
}

/**
 * Finds the bookkeeping settings of a tenant.
 * @param tenantId - The tenant.
 * @returns The settings, or undefined when it has none.
 */
async function findSettingsOf(tenantId: string): Promise<BookkeepingSettings | undefined> {
    return await inTenant(tenantId, async () => await journal().findSettings());
}

afterAll(async () => {
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.inMemory.shutdown);

describe('tenantsWithoutBooks set to never', () => {
    it('creates the bookkeeping settings of a tenant created through its repository', async () => {
        await withServer(createDataSource(), never, async () => {
            const tenant: TestTenant = await tenants().create({ name: 'Acme', deactivatedAt: null });

            expect(await findSettingsOf(tenant.id)).toMatchObject({
                tenantId: tenant.id,
                currency: 'EUR',
                legalForms: [{ legalForm: 'GmbH', validFrom: day('2020-01-01') }]
            });
        });
    }, TestTimeouts.inMemory.start);

    it('leaves neither the tenant nor its settings once the transaction it is created in is rolled back', async () => {
        await withServer(createDataSource(), never, async () => {
            const transaction: Transaction = await tenants().dataSource.startTransaction();
            const tenant: TestTenant = await tenants().create({ name: 'Rolled back', deactivatedAt: null }, { transaction });
            expect(await inTenant(tenant.id, async () => await journal().findSettings(transaction))).toBeDefined();
            await transaction.rollback();

            expect(await tenants().findOne({ where: { id: tenant.id }, required: false })).toBeUndefined();
            expect(await findSettingsOf(tenant.id)).toBeUndefined();
        });
    }, TestTimeouts.inMemory.start);

    it('refuses a tenant whose settings cannot be resolved or created', async () => {
        await withServer(createDataSource(), never, async () => {
            await expect(tenants().create({ name: 'Refused', deactivatedAt: null })).rejects.toThrow('The tenant Refused keeps no books here.');
            await expect(tenants().create({ name: 'Invalid', deactivatedAt: null }))
                .rejects.toThrow('The validFrom needs to be a day without a time, such as 2026-03-31.');
            await expect(tenants().create({ name: 'Unregistered', deactivatedAt: null }))
                .rejects.toThrow('The bookkeeping settings of a GmbH need the name, seat, registerCourt, registerNumber of its company, § 264 (1a) HGB.');

            expect(await tenants().findAll({ where: { name: { oneOf: ['Refused', 'Invalid', 'Unregistered'] } } })).toEqual([]);
            expect(await inject<Repository<BookkeepingSettings>>(repositoryTokenFor(BookkeepingSettings)).findAll({ acrossTenants: true })).toEqual([]);
        });
    }, TestTimeouts.inMemory.start);

    it('refuses to start while a tenant has no bookkeeping settings, naming it', async () => {
        const dataSource: Newable<InMemoryDataSource> = createDataSource();
        let keeping: string = '';
        let without: string = '';
        await withServer(dataSource, { tenantsWithoutBooks: 'post-nothing' }, async () => {
            keeping = await createTenant('Keeping', true);
            without = await createTenant('Without', false);
        });

        const starting: Promise<void> = withServer(dataSource, never);

        await expect(starting).rejects.toThrow(`The tenants ${without} have no bookkeeping settings`);
        await expect(starting).rejects.not.toThrow(keeping);
    }, TestTimeouts.inMemory.start * 3);

    it('starts once every tenant has bookkeeping settings', async () => {
        const dataSource: Newable<InMemoryDataSource> = createDataSource();
        await withServer(dataSource, { tenantsWithoutBooks: 'post-nothing' }, async () => {
            await createTenant('First', true);
            await createTenant('Second', true);
        });

        await expect(withServer(dataSource, never)).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.start * 3);

    it('starts with a deactivated tenant without bookkeeping settings', async () => {
        const dataSource: Newable<InMemoryDataSource> = createDataSource();
        await withServer(dataSource, { tenantsWithoutBooks: 'post-nothing' }, async () => {
            await createTenant('Keeping', true);
            await createTenant('Deactivated', false, new Date());
        });

        await expect(withServer(dataSource, never)).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.start * 3);

    it('refuses to start without an entity of the tenants', async () => {
        await expect(withServer(createDataSource([]), never))
            .rejects.toThrow('ZibriBookkeepingPlugin with tenantsWithoutBooks set to never needs an entity of the tenants');
    }, TestTimeouts.inMemory.start);

    it('takes resolveSettingsOf with never only', () => {
        const providers: DiProvider<BookkeepingPluginOptionsInput>[] = [
            // @ts-expect-error never needs the settings each tenant is created with
            defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'never' } }),
            // @ts-expect-error another value takes none
            defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'refuse', resolveSettingsOf } }),
            defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'never', resolveSettingsOf } })
        ];

        expect(providers).toHaveLength(3);
    });
});