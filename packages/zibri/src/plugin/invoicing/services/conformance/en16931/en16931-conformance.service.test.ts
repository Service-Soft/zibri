import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PeppolConformanceService } from './peppol-conformance.service';
import { createTestDataSource, defaultTestServerEntities } from '../../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../../../../../data-source/data-sources/postgres-typeorm-data-source.model';
import { Repository } from '../../../../../data-source/repository';
import { repositoryTokenFor } from '../../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../../di/inject.function';
import { defineProvider } from '../../../../../di/models/di-provider.model';
import { BaseEntity } from '../../../../../entity/base-entity.model';
import { Newable } from '../../../../../types/newable.type';
import { OmitStrict } from '../../../../../types/omit-strict.type';
import { Ms } from '../../../../../utilities/ms';
import { ZibriInvoicingPlugin } from '../../../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing.tokens';
import { Invoice } from '../../../models/invoice.model';
import { InvoicingOptions } from '../../../models/invoicing-options.model';
import { NumberInvoices } from '../../../models/number-invoices.model';

const baseInvoicingOptions: InvoicingOptions = {
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

function createValidInvoiceData(): OmitStrict<Invoice, 'id'> {
    return {
        // eslint-disable-next-line cspell/spellchecker
        number: `${new Date().getFullYear()}-GREATC-${Math.random().toString(36)
            .slice(2)}`,
        currency: 'EUR',
        items: [
            {
                name: 'Testing',
                amount: 4,
                amountUnit: { displayName: 'Hours', code: 'HUR' },
                vat: { categoryCode: 'E', rate: 0, exemptionReason: '§19 small business' },
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
    };
}

describe('EN16931ConformanceService (base class error branches, exercised via PeppolConformanceService)', () => {
    const dataSourceClass: Newable<PostgresDataSource & { entities: Newable<BaseEntity>[] }> = createTestDataSource({
        entities: [...defaultTestServerEntities, Invoice, NumberInvoices]
    });

    let server: StartedTestServer;
    let repo: Repository<Invoice, OmitStrict<Invoice, 'id'>>;
    let conformanceService: PeppolConformanceService;

    async function reInitWithOptions(options: InvoicingOptions): Promise<void> {
        await server.reInit({
            plugins: [new ZibriInvoicingPlugin()],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: options })
            ]
        });
        repo = inject(repositoryTokenFor(Invoice));
        conformanceService = inject(PeppolConformanceService);
    }

    beforeAll(async () => {
        server = await startTestServer({
            plugins: [new ZibriInvoicingPlugin()],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: baseInvoicingOptions })
            ]
        });
        repo = inject(repositoryTokenFor(Invoice));
        conformanceService = inject(PeppolConformanceService);
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('rejects when no CEO/trade contact has been provided', async () => {
        await reInitWithOptions({
            ...baseInvoicingOptions,
            companyInfo: { ...baseInvoicingOptions.companyInfo, ceo: undefined as unknown as string }
        });
        const invoice: Invoice = await repo.create(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/No trade contact has been provided/);
    }, 15000);

    it('rejects when the iban is missing', async () => {
        await reInitWithOptions({
            ...baseInvoicingOptions,
            companyInfo: { ...baseInvoicingOptions.companyInfo, iban: undefined as unknown as string }
        });
        const invoice: Invoice = await repo.create(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/iban and bic need to be provided/);
    }, 15000);

    it('rejects when the bic is missing', async () => {
        await reInitWithOptions({
            ...baseInvoicingOptions,
            companyInfo: { ...baseInvoicingOptions.companyInfo, bic: undefined as unknown as string }
        });
        const invoice: Invoice = await repo.create(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/iban and bic need to be provided/);
    }, 15000);

    it('rejects when a tax-exempt item has no exemption reason', async () => {
        await reInitWithOptions(baseInvoicingOptions);
        const data: OmitStrict<Invoice, 'id'> = createValidInvoiceData();
        data.items[0].vat.exemptionReason = undefined;
        const invoice: Invoice = await repo.create(data);
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/No exemption reason has been provided/);
    }, 15000);

    it('rejects when the customer email is missing', async () => {
        await reInitWithOptions(baseInvoicingOptions);
        const data: OmitStrict<Invoice, 'id'> = createValidInvoiceData();
        data.customerAddressData.email = undefined;
        const invoice: Invoice = await repo.create(data);
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/No customer email has been provided/);
    }, 15000);

    it('rejects when the company tax number is missing', async () => {
        await reInitWithOptions({
            ...baseInvoicingOptions,
            companyInfo: { ...baseInvoicingOptions.companyInfo, taxNumber: undefined as unknown as string }
        });
        const invoice: Invoice = await repo.create(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice)).rejects.toThrow(/No tax number has been provided/);
    }, 15000);
});