/* eslint-disable typescript/no-deprecated, cspell/spellchecker -- the overrides of 3.2, which 3.x keeps until 4.0 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from '../../../__testing__/test-server/plugins';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../../../data-source/repository/repository-class.type';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { InvoicingOptions } from '../models/invoicing-options.model';
import { NumberInvoices } from '../models/number-invoices.model';
import { NumberingContext } from '../models/numbering-context.model';
import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';
import { InvoiceNumberService } from './invoice-number.service';

/**
 * A class of an application of 3.2 extending `InvoiceNumberService` still compiles, and its overrides take effect
 * for the numbers of the default format, as do invoicing options written out whole for 3.2.
 */

const TEAM: string = UUIDUtilities.generate();

/**
 * The year the numbers of the application are drawn in, whatever the calendar says, such as the one of a fiscal
 * year.
 */
const FISCAL_YEAR: number = 1999;

const customer: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: '',
    number: '',
    postcode: '',
    city: '',
    company: true,
    companyName: 'Acme',
    countryId: 'DE'
};

/**
 * The invoicing options as an application of 3.2 wrote them out whole, without any option 3.3 added.
 */
const OPTIONS_OF_32: InvoicingOptions = {
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

/**
 * An invoice number service as an application of 3.2 extended it: numbering in its fiscal year, and marking the
 * consecutive numbers it draws.
 */
class FiscalYearInvoiceNumberService extends InvoiceNumberService {
    // the type of what it answers, which a class of its own names
    protected override async resolveNumberingContext(): Promise<NumberingContext> {
        return await super.resolveNumberingContext();
    }

    protected override async resolveCurrentYear(): Promise<number> {
        return await Promise.resolve(FISCAL_YEAR);
    }

    protected override async resolveConsecutiveNumber(
        recipientId: string,
        currentYear: number,
        transaction: RepositoryTransaction | undefined
    ): Promise<string> {
        return `${await super.resolveConsecutiveNumber(recipientId, currentYear, transaction)}F`;
    }

    protected override async resolveTemporaryConsecutiveNumber(recipientId: string, currentYear: number): Promise<string> {
        return `${await super.resolveTemporaryConsecutiveNumber(recipientId, currentYear)}F`;
    }
}

@DataSource()
class InvoicingDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer;
let numbers: InvoiceNumberServiceInterface<InvoiceAddress>;

/**
 * Runs the given work in the team.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TEAM, fn);
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [InvoicingDataSource],
        plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
            })),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS, useValue: OPTIONS_OF_32 }),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE, useClass: FiscalYearInvoiceNumberService })
        ]
    });
    numbers = inject<InvoiceNumberServiceInterface<InvoiceAddress>>(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('a class of 3.2 extending InvoiceNumberService', () => {
    it('draws the numbers of the default format in the year and with the consecutive number its overrides answer', async () => {
        const first: string = await inTeam(async () => await numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME'));
        const second: string = await inTeam(async () => await numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME'));

        expect([first, second]).toEqual([`${FISCAL_YEAR}-ACME-0001F`, `${FISCAL_YEAR}-ACME-0002F`]);
    });

    it('reads a temporary number through its override as well, drawing none', async () => {
        const temporary: string = await inTeam(async () => await numbers.generateTemporaryInvoiceNumber('acme', customer, 'ACME'));
        const next: string = await inTeam(async () => await numbers.generateInvoiceNumber('acme', customer, undefined, 'ACME'));

        expect([temporary, next]).toEqual([`TEMP-${FISCAL_YEAR}-ACME-0003F`, `${FISCAL_YEAR}-ACME-0003F`]);
    });

    it('numbers a credit note in the default format of credit notes, which its consecutive number does not draw', async () => {
        const creditNote: string | undefined = await inTeam(async () => await numbers.generateCreditNoteNumber?.(`${FISCAL_YEAR}-ACME-0001F`));

        expect(creditNote).toBe(`${FISCAL_YEAR}-ACME-0001F-C1`);
    });
});
