/* cspell:disable */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvoiceNumberService } from './invoice-number.service.ts';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { UUIDUtilities } from '../../../utilities/uuid.utilities.ts';
import { ZibriInvoicingPlugin } from '../invoicing.plugin.ts';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens.ts';
import { CompanyInfo } from '../models/company-info.model.ts';
import { InvoiceAddress } from '../models/invoice-address.model.ts';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model.ts';
import { Invoice } from '../models/invoice.model.ts';
import { InvoicingOptions } from '../models/invoicing-options.model.ts';
import { NumberInvoices } from '../models/number-invoices.model.ts';

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

        await expect(start).rejects.toThrow(
            /Error initializing ZibriInvoicingPlugin[\S\s]*- Invoice\n[\S\s]*- NumberInvoices\n[\S\s]*- InvoiceRecipientAbbreviation/
        );
    }, 30000);
});

describe('generateInvoiceNumber', () => {
    beforeAll(async () => {
        testServer = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
            plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
                companyInfoProvider(() => companyInfo)
            ]
        });
        invoiceRepo = inject(repositoryTokenFor(Invoice));
        invoiceNumberService = inject(InvoiceNumberService);
    }, 30000);

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
});