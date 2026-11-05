/* eslint-disable cspell/spellchecker */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';
import { TestTimeouts } from '../../../__testing__/constants';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { runApplicationClockAhead } from '../../../__testing__/run-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../../../data-source/repository/repository-class.type';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { CompanyInfo } from '../models/company-info.model';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { NumberInvoices } from '../models/number-invoices.model';

/**
 * A team whose company sits in Berlin.
 */
const BERLIN_TEAM: string = UUIDUtilities.generate();

/**
 * A team whose company sits in New York.
 */
const NEW_YORK_TEAM: string = UUIDUtilities.generate();

/**
 * The company of a team, in the time zone it keeps its books in.
 * @param timezone - The time zone.
 * @returns The company.
 */
function companyIn(timezone: CompanyInfo['timezone']): CompanyInfo {
    return {
        name: 'Example Company',
        fullName: 'Example Company LLC',
        email: 'info@example.com',
        phone: '12345 67890123',
        timezone,
        address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
    };
}

const customer: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: '',
    number: '',
    postcode: '',
    city: '',
    company: true,
    companyName: 'Acme',
    countryId: 'DE'
};

@DataSource()
class InvoicingDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer;
let numbers: InvoiceNumberServiceInterface<InvoiceAddress>;

/**
 * Runs the given work in a team.
 * @param tenantId - The team.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [InvoicingDataSource],
        plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(tenantId => companyIn(tenantId === BERLIN_TEAM ? 'Europe/Berlin' : 'America/New_York'))
        ]
    });
    numbers = inject<InvoiceNumberServiceInterface<InvoiceAddress>>(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE);
}, TestTimeouts.inMemory.start);

afterEach(() => {
    jest.useRealTimers();
});

afterAll(async () => {
    await server.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('the year of an invoice number', () => {
    // 00:30 on New Year's Day in Berlin, 18:30 on New Year's Eve in New York
    const newYearInBerlin: number = Date.parse('2026-12-31T23:30:00.000Z');

    it('is the year of the time zone of the company issuing it', async () => {
        runApplicationClockAhead(newYearInBerlin - Date.now());

        const berlin: string = await inTeam(BERLIN_TEAM, async () => await numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME'));
        const newYork: string = await inTeam(NEW_YORK_TEAM, async () => await numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME'));

        expect(berlin).toBe('2027-ACME-0001');
        expect(newYork).toBe('2026-ACME-0001');
    });

    it('is the year of the time zone of the company for a temporary number too', async () => {
        runApplicationClockAhead(newYearInBerlin - Date.now());

        const berlin: string = await inTeam(BERLIN_TEAM, async () => await numbers.generateTemporaryInvoiceNumber('initech', customer, 'INITECH'));

        expect(berlin).toBe('TEMP-2027-INITECH-0001');
    });

    it('is refused outside a tenant, where no company issues it', async () => {
        await expect(numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME')).rejects.toBeInstanceOf(NoActiveTenantError);
    });
});