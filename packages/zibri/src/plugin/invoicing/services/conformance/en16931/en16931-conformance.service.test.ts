import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PeppolConformanceService } from './peppol-conformance.service';
import { XRechnungConformanceService } from './x-rechnung-conformance.service';
import { companyInfoProvider } from '../../../../../__testing__/mocks/company-info-provider.function';
import { createTestDataSource, defaultTestServerEntities } from '../../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../../../../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../../di/inject.function';
import { defineProvider } from '../../../../../di/models/di-provider.model';
import { BaseEntity } from '../../../../../entity/base-entity.model';
import { type TenantServiceInterface } from '../../../../../tenancy/tenant-service.interface';
import { Newable } from '../../../../../types/newable.type';
import { OmitStrict } from '../../../../../types/omit-strict.type';
import { Ms } from '../../../../../utilities/ms';
import { UUIDUtilities } from '../../../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../../../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing.tokens';
import { CompanyInfo } from '../../../models/company-info.model';
import { InvoiceRecipientAbbreviation } from '../../../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../../../models/invoice.model';
import { InvoicingOptions } from '../../../models/invoicing-options.model';
import { NumberInvoices } from '../../../models/number-invoices.model';

const baseInvoicingOptions: InvoicingOptions = {
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

const baseCompanyInfo: CompanyInfo = {
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
    taxOffice: 'Tax Office Example City',
    // which Peppol names the company by
    electronicAddress: { scheme: '9930', value: 'DE123456789' }
};

/**
 * The tenant the invoices of the tests are issued in.
 */
const TENANT: string = UUIDUtilities.generate();

function createValidInvoiceData(): OmitStrict<Invoice, 'id' | 'tenantId'> {
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
            email: 'info@great-company-llc.com',
            electronicAddress: { scheme: '9930', value: 'DE987654321' }
        },
        textBeforeItems: [''],
        textAfterItems: ['Unless otherwise stated, the date of delivery/service corresponds to the date of invoice.']
    };
}

describe('EN16931ConformanceService (base class error branches, exercised via PeppolConformanceService)', () => {
    const dataSourceClass: Newable<PostgresDataSource & { entities: Newable<BaseEntity>[] }> = createTestDataSource({
        entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation]
    });

    let server: StartedTestServer;
    let repo: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>;
    let conformanceService: PeppolConformanceService;

    async function reInitWithCompany(company: CompanyInfo): Promise<void> {
        await server.reInit({
            plugins: [new ZibriInvoicingPlugin()],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: baseInvoicingOptions }),
                companyInfoProvider(() => company)
            ]
        });
        repo = inject(repositoryTokenFor(Invoice));
        conformanceService = inject(PeppolConformanceService);
    }

    async function createInvoice(data: OmitStrict<Invoice, 'id' | 'tenantId'>): Promise<Invoice> {
        return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TENANT, async () => await repo.create(data));
    }

    beforeAll(async () => {
        server = await startTestServer({
            plugins: [new ZibriInvoicingPlugin()],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: baseInvoicingOptions }),
                companyInfoProvider(() => baseCompanyInfo)
            ]
        });
        repo = inject(repositoryTokenFor(Invoice));
        conformanceService = inject(PeppolConformanceService);
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('rejects when no CEO/trade contact has been provided', async () => {
        await reInitWithCompany({ ...baseCompanyInfo, ceo: undefined });
        const invoice: Invoice = await createInvoice(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice, 'UTC')).rejects.toThrow(/No trade contact has been provided/);
    }, 15000);

    it('rejects when the iban is missing', async () => {
        await reInitWithCompany({ ...baseCompanyInfo, iban: undefined });
        const invoice: Invoice = await createInvoice(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice, 'UTC')).rejects.toThrow(/iban and bic need to be provided/);
    }, 15000);

    it('rejects when the bic is missing', async () => {
        await reInitWithCompany({ ...baseCompanyInfo, bic: undefined });
        const invoice: Invoice = await createInvoice(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice, 'UTC')).rejects.toThrow(/iban and bic need to be provided/);
    }, 15000);

    it('rejects when a tax-exempt item has no exemption reason', async () => {
        await reInitWithCompany(baseCompanyInfo);
        const data: OmitStrict<Invoice, 'id' | 'tenantId'> = createValidInvoiceData();
        const [item] = data.items;
        assert(item, 'the invoice fixture carries no items');
        item.vat.exemptionReason = undefined;
        const invoice: Invoice = await createInvoice(data);
        await expect(conformanceService.generateXml(invoice, 'UTC')).rejects.toThrow(/No exemption reason has been provided/);
    }, 15000);

    it('rejects when the customer email is missing, and so is their electronic address', async () => {
        await reInitWithCompany(baseCompanyInfo);
        const data: OmitStrict<Invoice, 'id' | 'tenantId'> = createValidInvoiceData();
        data.customerAddressData.email = undefined;
        data.customerAddressData.electronicAddress = undefined;
        const invoice: Invoice = await createInvoice(data);
        // through XRechnung, as only a standard naming a party by its email without an electronic
        // address reaches this; Peppol refuses the missing address first
        await expect(inject(XRechnungConformanceService).generateXml(invoice, 'UTC')).rejects.toThrow(/No customer email has been provided/);
    }, 15000);

    it('rejects when the company tax number is missing', async () => {
        await reInitWithCompany({ ...baseCompanyInfo, taxNumber: undefined });
        const invoice: Invoice = await createInvoice(createValidInvoiceData());
        await expect(conformanceService.generateXml(invoice, 'UTC')).rejects.toThrow(/No tax number has been provided/);
    }, 15000);
});