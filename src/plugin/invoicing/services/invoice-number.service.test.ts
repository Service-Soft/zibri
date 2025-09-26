/* eslint-disable cspell/spellchecker */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';
import { PostgresConnectionCredentialsOptions } from 'typeorm/driver/postgres/PostgresConnectionCredentialsOptions';

import { InvoiceCalcService } from './invoice-calc.service';
import { BaseDataSource, DataSource, DataSourceOptions, MigrationEntity, Repository } from '../../../data-source';
import { BaseEntity } from '../../../entity';
import { Newable, OmitStrict } from '../../../types';
import { Invoice, InvoiceAddress, InvoicingOptions, NumberInvoices } from '../models';
import { InvoiceNumberService } from './invoice-number.service';
import { POSTGRES_TEST_IMAGE } from '../../../__testing__';

const currentYear: string = new Date()
    .getFullYear()
    .toString();

const invoicingOptions: InvoicingOptions = {
    footerFontSize: 10,
    images: undefined,
    logo: undefined,
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
    numberPrivateCustomerAbbreviationCharacters: 3,
    companyInfo: {
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
        bic: 'ABCD5F'
    },
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

// eslint-disable-next-line unusedImports/no-unused-vars
const invoiceCalcService: InvoiceCalcService = new InvoiceCalcService();

@DataSource()
class DbDataSource extends BaseDataSource {
    options: DataSourceOptions = {
        type: 'postgres',
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [Invoice, NumberInvoices, MigrationEntity];
}

let container: StartedTestContainer;
let dataSource: DbDataSource;
let invoiceRepo: Repository<Invoice, OmitStrict<Invoice, 'id'>>;
let numberInvoicesRepo: Repository<NumberInvoices, OmitStrict<NumberInvoices, 'id'>>;
let invoiceNumberService: InvoiceNumberService;

describe('generateInvoiceNumber', () => {
    beforeAll(async () => {
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        dataSource = new DbDataSource();
        (dataSource.options as PostgresConnectionCredentialsOptions) = {
            ...dataSource.options as PostgresConnectionCredentialsOptions,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();
        invoiceRepo = dataSource.getRepository(Invoice);
        numberInvoicesRepo = dataSource.getRepository(NumberInvoices);
        invoiceNumberService = new InvoiceNumberService(invoiceRepo, numberInvoicesRepo, invoicingOptions);
    }, 15000);

    afterAll(async () => {
        await container.stop();
    });

    it('should generate the expected number for a company customer', async () => {
        const number: string = await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined);
        expect(number).toEqual(`${currentYear}-GREATC-0001`);

        const invoice: OmitStrict<Invoice, 'id'> = {
            number: number,
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
        await invoiceRepo.create(invoice);
        const number2: string = await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined);
        expect(number2).toEqual(`${currentYear}-GREATC-0002`);
    });

    it('should generate the expected number for a private customer', async () => {
        const number: string = await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined);
        expect(number).toEqual(`${currentYear}-JAMSMI-0001`);
        const number2: string = await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined);
        expect(number2).toEqual(`${currentYear}-JAMSMI-0002`);
    });

    it('should use the provided name abbreviation', async () => {
        const number: string = await invoiceNumberService.generateInvoiceNumber('2', privateCustomerData, undefined, 'XXX');
        expect(number).toEqual(`${currentYear}-XXX-0003`);
    });

    it('should throw an error if the invoice number already exists', async () => {
        const invoice: OmitStrict<Invoice, 'id'> = {
            number: `${currentYear}-GREATC-0003`,
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
        await invoiceRepo.create(invoice);
        try {
            await invoiceNumberService.generateInvoiceNumber('1', companyData, undefined);
            expect(true).toEqual(false);
        }
        catch (error) {
            expect((error as Error).message).toEqual(`The generated invoice-number ${currentYear}-GREATC-0003 already exists!`);
        }
    });

    it('should generate the expected number for a company customer', async () => {
        const number: string = await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData);
        // This is because transactions are not supported by memory databases
        expect(number).toEqual(`TEMP-${currentYear}-GREATC-0004`);
        const number2: string = await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData);
        expect(number2).toEqual(number);
    });

    it('should generate the expected number for a private customer', async () => {
        const number: string = await invoiceNumberService.generateTemporaryInvoiceNumber('2', privateCustomerData);
        expect(number).toEqual(`TEMP-${currentYear}-JAMSMI-0004`);
        const number2: string = await invoiceNumberService.generateTemporaryInvoiceNumber('2', privateCustomerData);
        expect(number2).toEqual(number);
    });

    it('should append a ascending number if the invoice number already exists', async () => {
        const invoice: OmitStrict<Invoice, 'id'> = {
            number: `TEMP-${currentYear}-GREATC-0004`,
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
        await invoiceRepo.create(invoice);
        const number: string = await invoiceNumberService.generateTemporaryInvoiceNumber('1', companyData);
        expect(number).toEqual(`TEMP-${currentYear}-GREATC-0004-2`);
    });
});