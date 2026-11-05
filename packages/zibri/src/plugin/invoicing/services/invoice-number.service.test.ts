/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { InvoiceNumberService } from './invoice-number.service';
import { TestTimeouts } from '../../../__testing__/constants';
import { missingEntityPattern } from '../../../__testing__/missing-entity-pattern.function';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { getZonedDate } from '../../../localization/format-date.function';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../../types/omit-strict.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { CompanyInfo } from '../models/company-info.model';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { InvoicingOptions } from '../models/invoicing-options.model';
import { NumberInvoices } from '../models/number-invoices.model';

// in the zone of the company below, which decides the year an invoice is numbered in
const currentYear: string = getZonedDate(new Date(), 'Europe/Berlin').year.toString();

const invoicingOptions: InvoicingOptions = {
    pageSize: 'A4',
    font: 'Roboto',
    footerFontSize: 10,
    images: undefined,
    phoneLabel: 'Phone',
    emailLabel: 'E-Mail',
    headline: 'Invoice',
    headlineFontSize: 20,
    invoiceNumberLabel: 'Invoice-No.',
    invoiceNumberNotice: 'Please specify when making payments and invoicing!',
    dateLabel: 'Date',
    performanceDateLabel: 'Date of performance',
    showPerformanceDate: false,
    showDueDate: true,
    dueDateLabel: 'Due date',
    tableFontSize: 12,
    itemNameLabel: 'Name',
    totalLabel: 'Total',
    totalBeforeTaxLabel: 'Total (excl. tax)',
    totalAfterTaxLabel: 'Total (incl. tax)',
    taxLabel: 'VAT',
    taxNumberLabel: 'Tax number:',
    ceoLabel: 'CEO:',
    itemAmountLabel: 'Amount',
    itemSinglePriceLabel: 'Price',
    itemTotalPriceLabel: 'Total',
    bankDetailsLabel: 'Bank details:',
    ibanLabel: 'IBAN:',
    bicLabel: 'BIC/SWIFT:',
    numberOfDigits: 4,
    separator: '-',
    numberCompanyAbbreviationCharacters: 6,
    numberPrivateCustomerAbbreviationCharacters: 3
};

const companyInfo: CompanyInfo = {
    name: 'Example Company',
    fullName: 'Example Company LLC',
    email: 'info@example-company.com',
    phone: '12345 67890123',
    timezone: 'Europe/Berlin',
    address: {
        street: 'Example street',
        number: '1b',
        postcode: '12345',
        city: 'Example city',
        countryId: 'DE'
    },
    taxNumber: '123/456/78910',
    ceo: 'James Smith',
    iban: 'DE75 5121 0800 1245 1261 99',
    bic: 'ABCD5F',
    bankName: 'Example Bank',
    taxOffice: 'Tax Office Example City'
};

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

let testServer: StartedTestServer;
let invoiceRepo: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>;
let invoiceNumberService: InvoiceNumberService;

/**
 * Runs the given work in a tenant.
 * @param fn - The work.
 * @param tenantId - The tenant, the one of the tests by default.
 * @returns What the work answered.
 */
async function inTenant<T>(fn: () => Promise<T>, tenantId: string = TENANT): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

/**
 * An invoice to a company customer.
 * @param number - Its number.
 * @returns The invoice.
 */
function companyInvoice(number: string): OmitStrict<Invoice, 'id' | 'tenantId'> {
    return {
        number,
        items: [
            {
                name: 'Testing',
                amount: 4,
                amountUnit: {
                    displayName: 'Hours',
                    code: 'HUR'
                },
                vat: {
                    categoryCode: 'S',
                    rate: 19
                },
                price: 90
            }
        ],
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: companyData,
        textBeforeItems: [''],
        textAfterItems: [''],
        currency: 'EUR'
    };
}

// first, for the reason on startAndStopTestServerWithout
describe('ZibriInvoicingPlugin — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
                companyInfoProvider(() => companyInfo)
            ]
        });

        await expect(start).rejects.toThrow(missingEntityPattern('Invoice', 'ZibriInvoicingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('NumberInvoices', 'ZibriInvoicingPlugin'));
        await expect(start).rejects.toThrow(missingEntityPattern('InvoiceRecipientAbbreviation', 'ZibriInvoicingPlugin'));
    }, TestTimeouts.inMemory.start);
});

describe('generateInvoiceNumber', () => {
    beforeAll(async () => {
        testServer = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation], repositories: defaultTestServerRepositories })],
            plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
                companyInfoProvider(() => companyInfo)
            ]
        });
        invoiceRepo = inject(repositoryTokenFor(Invoice));
        invoiceNumberService = inject(InvoiceNumberService);
    }, 50000);

    afterAll(async () => {
        await testServer.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('should generate the expected number for a company customer', async () => {
        const number: string = await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined));
        expect(number).toEqual(`${currentYear}-GREATC-0001`);

        await inTenant(async () => await invoiceRepo.create(companyInvoice(number)));
        const number2: string = await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined));
        expect(number2).toEqual(`${currentYear}-GREATC-0002`);
    });

    it('should generate the expected number for a private customer', async () => {
        const number: string = await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined));
        expect(number).toEqual(`${currentYear}-JAMSMI-0001`);
        const number2: string = await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined));
        expect(number2).toEqual(`${currentYear}-JAMSMI-0002`);
    });

    it('should use the provided name abbreviation', async () => {
        const number: string = await inTenant(
            async () => await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined, 'XXX')
        );
        expect(number).toEqual(`${currentYear}-XXX-0003`);
    });

    it('should throw an error if the invoice number already exists', async () => {
        await inTenant(async () => await invoiceRepo.create(companyInvoice(`${currentYear}-GREATC-0003`)));
        try {
            await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined));
            expect(true).toEqual(false);
        }
        catch (error) {
            expect((error as Error).message).toEqual(`The generated invoice-number ${currentYear}-GREATC-0003 already exists!`);
        }
    });

    it('should generate the expected number for a company customer', async () => {
        const number: string = await inTenant(async () => await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData));
        // This is because transactions are not supported by memory databases
        expect(number).toEqual(`TEMP-${currentYear}-GREATC-0004`);
        const number2: string = await inTenant(async () => await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData));
        expect(number2).toEqual(number);
    });

    it('should generate the expected number for a private customer', async () => {
        const number: string = await inTenant(async () => await invoiceNumberService.generateTemporaryInvoiceNumber('2', privateCustomerData));
        // the abbreviation the recipient holds since it was given one, rather than the suggested one
        expect(number).toEqual(`TEMP-${currentYear}-XXX-0004`);
        const number2: string = await inTenant(async () => await invoiceNumberService.generateTemporaryInvoiceNumber('2', privateCustomerData));
        expect(number2).toEqual(number);
    });

    it('should append a ascending number if the invoice number already exists', async () => {
        await inTenant(async () => await invoiceRepo.create(companyInvoice(`TEMP-${currentYear}-GREATC-0004`)));
        const number: string = await inTenant(async () => await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData));
        expect(number).toEqual(`TEMP-${currentYear}-GREATC-0004-2`);
    });

    it('numbers the invoices of each tenant on their own, the same numbers in both', async () => {
        const otherTenant: string = UUIDUtilities.generate();

        const number: string = await inTenant(
            async () => await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined),
            otherTenant
        );
        expect(number).toEqual(`${currentYear}-GREATC-0001`);
        // a number another tenant holds already is free in this one
        await inTenant(async () => await invoiceRepo.create(companyInvoice(number)), otherTenant);
    });

    // an invoice number is a legal identifier. Read, incremented and written back as separate steps,
    // two callers interleave even inside one process, and two invoices carry the same number
    it('gives every concurrent caller its own number', async () => {
        // the counter exists already, so every caller increments it rather than creating it
        await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('concurrent-recipient', companyData, undefined, 'CONCUR'));

        const numbers: string[] = await inTenant(async () => await Promise.all([
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', companyData, undefined, 'CONCUR'),
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', companyData, undefined, 'CONCUR'),
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', companyData, undefined, 'CONCUR')
        ]));

        expect(new Set(numbers).size).toBe(numbers.length);
    });

    // concurrent first callers of a recipient each created a counter of their own, every one at 1
    it('counts every issued number exactly once', async () => {
        await inTenant(async () => await Promise.all([
            invoiceNumberService.generateInvoiceNumber('counted-recipient', companyData, undefined, 'COUNTE'),
            invoiceNumberService.generateInvoiceNumber('counted-recipient', companyData, undefined, 'COUNTE'),
            invoiceNumberService.generateInvoiceNumber('counted-recipient', companyData, undefined, 'COUNTE')
        ]));

        const counters: NumberInvoices[] = await inTenant(async () => await inject(repositoryTokenFor(NumberInvoices)).findAll({
            where: { recipientId: 'counted-recipient' }
        }));
        expect(counters).toHaveLength(1);
        expect(counters[0]?.number).toBe(3);
    });

    // the increment becomes visible on the caller's commit, so anything held only until the number is
    // claimed - a lock released at the end of its body - lets the next caller read the same counter
    it('gives every caller its own number when each one runs inside its own transaction', async () => {
        await inTenant(async () => await invoiceNumberService.generateInvoiceNumber('transactional-recipient', companyData, undefined, 'TRANSA'));

        /**
         * Issues a number inside a transaction of its own, committed as soon as the number comes back.
         * @returns The number.
         */
        async function issueNumber(): Promise<string> {
            const transaction: Transaction = await invoiceRepo.dataSource.startTransaction();
            const number: string = await invoiceNumberService.generateInvoiceNumber('transactional-recipient', companyData, transaction, 'TRANSA');
            await transaction.commit();
            return number;
        }
        const numbers: string[] = await inTenant(async () => await Promise.all([issueNumber(), issueNumber(), issueNumber()]));

        expect(new Set(numbers).size).toBe(numbers.length);
    });
});