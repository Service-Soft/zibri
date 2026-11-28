import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { getZonedDate } from '../../../localization/get-zoned-date.function';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { NumberInvoices } from '../models/number-invoices.model';
import { NumberingContext } from '../models/numbering-context.model';
import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';
import { InvoiceNumberService } from './invoice-number.service';

// the context a class extending InvoiceNumberService answers: a fiscal year replaces the year of the moment
// numbered at alone, and {month} stays the calendar month

const TEAM: string = UUIDUtilities.generate();

/**
 * The year the numbers are drawn in, whatever the calendar says, such as the one of a fiscal year.
 */
const FISCAL_YEAR: number = 1999;

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

/**
 * Numbers in its fiscal year, through the context it answers.
 */
class FiscalYearInvoiceNumberService extends InvoiceNumberService {
    protected override async resolveNumberingContext(): Promise<NumberingContext> {
        const context: NumberingContext = await super.resolveNumberingContext();
        return { ...context, date: { ...context.date, year: FISCAL_YEAR } };
    }
}

let server: StartedTestServer;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
            })),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { numberFormat: '{year}-{month}-{counter}' } }),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE, useClass: FiscalYearInvoiceNumberService })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('a numbering context of a class extending InvoiceNumberService', () => {
    it('numbers in the year it answers, and in the month of the moment numbered at', async () => {
        const numbers: InvoiceNumberServiceInterface<InvoiceAddress> = inject<InvoiceNumberServiceInterface<InvoiceAddress>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE
        );
        const month: string = String(getZonedDate(new Date(), 'Europe/Berlin').month + 1).padStart(2, '0');

        const number: string = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            TEAM,
            async () => await numbers.generateInvoiceNumber('acme', customer, undefined)
        );

        expect(number).toBe(`${FISCAL_YEAR}-${month}-0001`);
    });
});