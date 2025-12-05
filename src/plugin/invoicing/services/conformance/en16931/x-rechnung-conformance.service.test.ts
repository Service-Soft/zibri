
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { afterAll, beforeAll, describe, it } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';
import { PostgresConnectionCredentialsOptions } from 'typeorm/driver/postgres/PostgresConnectionCredentialsOptions';

import { XRechnungConformanceService } from './x-rechnung-conformance.service';
import { POSTGRES_TEST_IMAGE, testFileFolder } from '../../../../../__testing__';
import { BaseDataSource, DataSource, DataSourceOptions, MigrationEntity, Repository } from '../../../../../data-source';
import { XML } from '../../../../../document';
import { BaseEntity } from '../../../../../entity/base-entity.model';
import { Newable, OmitStrict } from '../../../../../types';
import { Ms } from '../../../../../utilities';
import { InvoicingOptions, Invoice } from '../../../models';
import { InvoiceCalcService } from '../../invoice-calc.service';

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

const invoiceCalcService: InvoiceCalcService = new InvoiceCalcService();
const conformanceService: XRechnungConformanceService = new XRechnungConformanceService(invoicingOptions, invoiceCalcService);

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
    entities: Newable<BaseEntity>[] = [Invoice, MigrationEntity];
}

let container: StartedTestContainer;
let dataSource: DbDataSource;
let repo: Repository<Invoice, OmitStrict<Invoice, 'id'>>;

describe('generateXml', () => {
    beforeAll(async () => {
        await mkdir(testFileFolder, { recursive: true });
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
        repo = dataSource.getRepository(Invoice);
    }, 15000);

    afterAll(async () => {
        await container.stop();
    });

    it('should create the expected result', async () => {
        const invoice: Invoice = await repo.create({
            // eslint-disable-next-line cspell/spellchecker
            number: `${new Date().getFullYear()}-GREATC-0001`,
            currency: 'EUR',
            items: [
                {
                    name: 'Testing',
                    amount: 4,
                    amountUnit: {
                        displayName: 'Hours',
                        code: 'HUR'
                    },
                    vat: {
                        categoryCode: 'E',
                        rate: 0,
                        exemptionReason: '§19 small business'
                    },
                    price: 90
                }
            ],
            date: new Date(),
            performanceDate: new Date(),
            dueDate: new Date(Date.now() + (Ms.WEEK * 2)),
            customerAddressData: {
                formOfAddress: '',
                firstName: '',
                lastName: '',
                street: 'Great Street',
                number: '42',
                postcode: '12345',
                city: 'Great City',
                company: true,
                companyName: 'Great Company LLC',
                countryId: 'DE',
                email: 'info@great-company-llc.com'
            },
            textBeforeItems: [''],
            textAfterItems: ['Unless otherwise stated, the date of delivery/service corresponds to the date of invoice.']
        });

        const xml: XML = await conformanceService.generateXml(invoice);
        const xmlString: string = xml.end({ prettyPrint: true });
        await writeFile(path.join(testFileFolder, 'xrechnung.xml'), xmlString);
    });
});