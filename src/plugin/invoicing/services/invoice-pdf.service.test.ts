import { WriteStream } from 'node:fs';

import { afterAll, beforeAll, describe, it } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';

import { XRechnungConformanceService } from './conformance/en16931/x-rechnung-conformance.service';
import { InvoiceCalcService } from './invoice-calc.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { POSTGRES_TEST_IMAGE, testFileFolder } from '../../../__testing__/constants';
import { PostgresDataSource, PostgresOptions } from '../../../data-source/data-sources/postgres-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../../data-source/migration/migration-entity.model';
import { Repository } from '../../../data-source/repository';
import { PdfDocument } from '../../../document/pdf.utilities';
import { BaseEntity } from '../../../entity/base-entity.model';
import { formatDate } from '../../../localization/formatting/format-date.function';
import { formatPercent } from '../../../localization/formatting/format-percent.function';
import { formatPrice } from '../../../localization/formatting/format-price.function';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { Ms } from '../../../utilities/ms';
import { Invoice } from '../models/invoice.model';
import { InvoicingOptions } from '../models/invoicing-options.model';

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
const xRechnungConformanceService: XRechnungConformanceService = new XRechnungConformanceService(invoicingOptions, invoiceCalcService);
const invoicePdfService: InvoicePdfService = new InvoicePdfService(
    invoicingOptions,
    invoiceCalcService,
    [xRechnungConformanceService],
    formatDate,
    formatPrice,
    formatPercent
);

@DataSource()
class DbDataSource extends PostgresDataSource {
    options: PostgresOptions = {
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

describe('createInvoicePdf', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(testFileFolder);
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        dataSource = new DbDataSource();
        dataSource.options = {
            ...dataSource.options,
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

        const pdf: PdfDocument = await invoicePdfService.generateInvoicePdf(invoice, 'x-rechnung');

        const out1: WriteStream = FsUtilities.createWriteStream(FsUtilities.getPath(testFileFolder, `${invoice.number}-stream-1.pdf`));
        const out2: WriteStream = FsUtilities.createWriteStream(FsUtilities.getPath(testFileFolder, `${invoice.number}-stream-2.pdf`));

        pdf.pipe(out1);
        pdf.pipe(out2);
        pdf.end();
    });
});