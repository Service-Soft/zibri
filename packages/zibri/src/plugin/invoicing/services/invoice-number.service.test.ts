/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { InvoiceNumberService } from './invoice-number.service';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../../types/omit-strict.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { CompanyInfo } from '../models/company-info.model';
import { InvoiceAddress } from '../models/invoice-address.model';
import { Invoice } from '../models/invoice.model';
import { InvoicingOptions } from '../models/invoicing-options.model';
import { NumberInvoices } from '../models/number-invoices.model';

const currentYear: string = new Date()
    .getFullYear()
    .toString();

const invoicingOptions: InvoicingOptions = {
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

        await expect(start).rejects.toThrow(/Error initializing ZibriInvoicingPlugin[\S\s]*- Invoice\n[\S\s]*- NumberInvoices/);
    }, 30000);
});

describe('generateInvoiceNumber', () => {
    beforeAll(async () => {
        testServer = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices] })],
            plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
                companyInfoProvider(() => companyInfo)
            ]
        });
        invoiceRepo = inject(repositoryTokenFor(Invoice));
        invoiceNumberService = inject(InvoiceNumberService);
    }, 15000);

    afterAll(async () => {
        await testServer.shutdown();
    }, 15000);

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
        expect(number).toEqual(`TEMP-${currentYear}-JAMSMI-0004`);
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
});