/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { InvoiceNumberService } from './invoice-number.service';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { NumberInvoices } from '../models/number-invoices.model';

// in memory, as the abbreviations are judged by the service alone, whichever store holds the counters.
// A file of its own, because an application refuses a data source declared by another one the same
// file booted, and invoice-number.service.test.ts boots the store of the test run

const currentYear: string = new Date()
    .getFullYear()
    .toString();

const companyData: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: '',
    number: '',
    postcode: '',
    city: '',
    company: true,
    companyName: 'great company llc',
    countryId: 'DE'
};

const privateCustomerData: InvoiceAddress = {
    formOfAddress: '',
    firstName: 'james',
    lastName: 'smith',
    street: '',
    number: '',
    postcode: '',
    city: '',
    company: false,
    countryId: 'DE'
};

/**
 * The tenant the invoices of the tests are issued in.
 */
const TENANT: string = UUIDUtilities.generate();

/**
 * Runs the given work in the tenant of the tests.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TENANT, fn);
}

describe('name abbreviations', () => {
    let server: StartedTestServer | undefined;
    let invoiceNumberService: InvoiceNumberService;
    let numberInvoicesRepo: Repository<NumberInvoices>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
            plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                companyInfoProvider(() => ({
                    name: 'Example Company',
                    fullName: 'Example Company LLC',
                    email: 'info@example-company.com',
                    phone: '12345 67890123',
                    address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                    taxNumber: '123/456/78910',
                    ceo: 'James Smith',
                    iban: 'DE75 5121 0800 1245 1261 99',
                    bic: 'ABCD5F'
                }))
            ]
        });
        invoiceNumberService = inject(InvoiceNumberService);
        numberInvoicesRepo = inject(repositoryTokenFor(NumberInvoices));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('suggests the first letters of a company name, or of first and last name', () => {
        expect(invoiceNumberService.getSuggestedNameAbbreviation(companyData)).toBe('GREATC');
        expect(invoiceNumberService.getSuggestedNameAbbreviation(privateCustomerData)).toBe('JAMSMI');
    });

    it('refuses the abbreviation another recipient holds, counts nothing for it, and keeps the one given instead', async () => await inTenant(async () => {
        const siemensAg: InvoiceAddress = { ...companyData, companyName: 'Siemens AG' };
        const siemensHealthineers: InvoiceAddress = { ...companyData, companyName: 'Siemens Healthineers' };
        expect(await invoiceNumberService.generateInvoiceNumber('siemens-ag', siemensAg, undefined)).toBe(`${currentYear}-SIEMEN-0001`);

        // twice, as a caller retrying without a transaction would: neither attempt may draw a number
        for (let attempt: number = 0; attempt < 2; attempt++) {
            await expect(invoiceNumberService.generateInvoiceNumber('siemens-healthineers', siemensHealthineers, undefined))
                .rejects.toThrow('The name abbreviation SIEMEN is already used by another recipient.');
        }
        expect(await numberInvoicesRepo.findAll({ where: { recipientId: 'siemens-healthineers' } })).toEqual([]);

        // given once, and numbered with from then on
        expect(await invoiceNumberService.generateInvoiceNumber('siemens-healthineers', siemensHealthineers, undefined, 'SIEHEA'))
            .toBe(`${currentYear}-SIEHEA-0001`);
        expect(await invoiceNumberService.generateInvoiceNumber('siemens-healthineers', siemensHealthineers, undefined))
            .toBe(`${currentYear}-SIEHEA-0002`);
        expect(await invoiceNumberService.generateInvoiceNumber('siemens-ag', siemensAg, undefined)).toBe(`${currentYear}-SIEMEN-0002`);
        // and given explicitly, one another recipient holds is refused as well
        await expect(invoiceNumberService.generateInvoiceNumber('siemens-ag', siemensAg, undefined, 'SIEHEA')).rejects.toThrow(ConflictError);
    }));
});