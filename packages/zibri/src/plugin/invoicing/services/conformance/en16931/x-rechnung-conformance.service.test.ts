import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { XRechnungConformanceService } from './x-rechnung-conformance.service';
import { testFileFolder } from '../../../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities } from '../../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../../data-source/repository';
import { repositoryTokenFor } from '../../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../../di/inject.function';
import { defineProvider } from '../../../../../di/models/di-provider.model';
import { XML } from '../../../../../document/xml.utilities';
import { OmitStrict } from '../../../../../types/omit-strict.type';
import { FsUtilities } from '../../../../../utilities/fs.utilities';
import { Ms } from '../../../../../utilities/ms';
import { ZibriInvoicingPlugin } from '../../../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing.tokens';
import { Invoice } from '../../../models/invoice.model';
import { InvoicingOptions } from '../../../models/invoicing-options.model';
import { NumberInvoices } from '../../../models/number-invoices.model';

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

let server: StartedTestServer;
let repo: Repository<Invoice, OmitStrict<Invoice, 'id'>>;
let conformanceService: XRechnungConformanceService;

describe('generateXml', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(testFileFolder);
        server = await startTestServer({
            plugins: [new ZibriInvoicingPlugin()],
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices] })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions })
            ]
        });

        repo = inject(repositoryTokenFor(Invoice));
        conformanceService = inject(XRechnungConformanceService);
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

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
        await FsUtilities.upsertFile(FsUtilities.getPath(testFileFolder, 'xrechnung.xml'), xmlString);

        expect(xmlString).toContain('urn:cen.eu:en16931:2017#compliant#urn:xrechnung:3.0');
        expect(xmlString).toContain(invoice.number);
        expect(xmlString).toContain('Great Company LLC');
        expect(xmlString).toContain('info@great-company-llc.com');
        expect(xmlString).toContain('Example Company LLC');
        expect(xmlString).toContain('DE75 5121 0800 1245 1261 99');
        expect(xmlString).toContain('ABCD5F');
        expect(xmlString).toContain('§19 small business');
        expect(xmlString).toContain('Testing');
        expect(xmlString).toContain('90');
    });
});