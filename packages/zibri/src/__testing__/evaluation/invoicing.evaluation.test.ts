/* cspell:disable */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { ZibriInvoicingPlugin } from '../../plugin/invoicing/invoicing.plugin.ts';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../plugin/invoicing/invoicing.tokens.ts';
import { CompanyInfo } from '../../plugin/invoicing/models/company-info.model.ts';
import { InvoiceAddress } from '../../plugin/invoicing/models/invoice-address.model.ts';
import { InvoiceRecipientAbbreviation } from '../../plugin/invoicing/models/invoice-recipient-abbreviation.model.ts';
import { Invoice } from '../../plugin/invoicing/models/invoice.model.ts';
import { InvoicingOptions } from '../../plugin/invoicing/models/invoicing-options.model.ts';
import { NumberInvoices } from '../../plugin/invoicing/models/number-invoices.model.ts';
import { InvoiceNumberService } from '../../plugin/invoicing/services/invoice-number.service.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { companyInfoProvider } from '../mocks/company-info-provider.function.ts';
import { createTestDataSource, defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerPlugins } from '../test-server/plugins.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.11.
 *
 * GetConsecutiveNumber reads the counter, increments it in javascript and writes it back
 * (invoice-number.service.ts). There is no row lock, no atomic increment, and no unique constraint
 * on (year, recipientId) to catch it afterwards.
 *
 * The original finding described this as a problem above one replica. It is worse than that: the
 * read and the write are separate awaits, so two concurrent requests interleave inside a *single*
 * process. No cluster is needed to produce two invoices carrying the same number, which under GoBD
 * or SdI is an audit finding rather than a bug report.
 *
 * All three are **closed**, in two steps worth keeping straight.
 *
 * The first attempt held a lock keyed by year and recipient across the read and the write. That
 * closed the first two tests and not the third, which was written afterwards: passing a transaction,
 * which is what the parameter on the public API is for, puts the write on the caller's commit while
 * the lock is released at the end of the critical section, so the lock stopped covering the window
 * it existed to cover.
 *
 * The lock is gone now. GetConsecutiveNumber claims its number with a single `upsert`, an
 * insert-or-increment with no window to interleave in at all.
 * It stays inside the caller's transaction, so an abandoned invoice rolls the number back rather
 * than leaving a gap in the sequence.
 */

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

/**
 * The tenant the invoices of the tests are issued in.
 */
const TENANT: string = UUIDUtilities.generate();

/**
 * Runs the given work in the tenant of the tests.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TENANT, fn);
}

const recipient: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: '',
    number: '',
    postcode: '',
    city: '',
    company: true,
    companyName: 'concurrent company llc',
    countryId: 'DE'
};

let server: StartedTestServer | undefined;
let invoiceNumberService: InvoiceNumberService;
let numberInvoicesRepository: Repository<NumberInvoices>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
        plugins: [...defaultTestServerPlugins, new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions }),
            companyInfoProvider(() => companyInfo)
        ]
    });
    invoiceNumberService = inject(InvoiceNumberService);
    numberInvoicesRepository = inject(repositoryTokenFor(NumberInvoices));
}, 15000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

describe('evaluation/04-infrastructure-subsystems 1.11 - invoice numbering', () => {

    it('gives every concurrent caller its own number', async () => await inTenant(async () => {
        await numberInvoicesRepository.deleteAll({});

        // the counter has to already exist, so that both callers take the read-modify-write branch
        // rather than the create branch - those are two different races and this test is about the
        // first one
        await invoiceNumberService.generateInvoiceNumber('concurrent-recipient', recipient, undefined, 'CONCUR');

        const numbers: string[] = await Promise.all([
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', recipient, undefined, 'CONCUR'),
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', recipient, undefined, 'CONCUR'),
            invoiceNumberService.generateInvoiceNumber('concurrent-recipient', recipient, undefined, 'CONCUR')
        ]);

        // an invoice number is a legal identifier, and two invoices carrying the same one is not
        // something the recipient can be asked to sort out afterwards
        expect(new Set(numbers).size).toBe(numbers.length);
    }), 30000);

    it('counts every issued number exactly once', async () => await inTenant(async () => {
        await numberInvoicesRepository.deleteAll({});

        await Promise.all([
            invoiceNumberService.generateInvoiceNumber('counted-recipient', recipient, undefined, 'COUNTE'),
            invoiceNumberService.generateInvoiceNumber('counted-recipient', recipient, undefined, 'COUNTE'),
            invoiceNumberService.generateInvoiceNumber('counted-recipient', recipient, undefined, 'COUNTE')
        ]);

        const counters: NumberInvoices[] = await numberInvoicesRepository.findAll({
            where: { recipientId: 'counted-recipient' }
        });

        // there is no unique constraint on (year, recipientId), so concurrent first-time callers
        // each insert their own counter row and every one of them starts again at 1
        expect(counters).toHaveLength(1);
        expect(counters[0]?.number).toBe(3);
    }), 30000);

    it('gives every caller its own number when each one runs inside its own transaction', async () => await inTenant(async () => {
        await numberInvoicesRepository.deleteAll({});
        // as above: seed the counter so both callers take the read-modify-write branch
        await invoiceNumberService.generateInvoiceNumber('transactional-recipient', recipient, undefined, 'TRANSA');

        // nothing is held open artificially and nothing sleeps: the transaction is committed as soon
        // as the number comes back. generateInvoiceNumber still calls validateInvoiceNumber, which
        // is a database roundtrip, after getConsecutiveNumber has already released the lock - so the
        // gap between releasing and committing is there on its own. A caller doing real work inside
        // the transaction, which is the only reason to pass one, only widens it.
        async function issueNumber(): Promise<string> {
            const transaction: Transaction = await numberInvoicesRepository.dataSource.startTransaction();
            const number: string = await invoiceNumberService.generateInvoiceNumber(
                'transactional-recipient',
                recipient,
                transaction,
                'TRANSA'
            );
            await transaction.commit();
            return number;
        }

        const numbers: string[] = await Promise.all([issueNumber(), issueNumber(), issueNumber()]);

        // a lock would be released at the end of its body, but the increment only becomes visible
        // when the caller commits - which happens after. The next caller would take the lock, read
        // the counter the previous one already claimed, and issue the same legal identifier again.
        expect(new Set(numbers).size).toBe(numbers.length);
    }), 30000);
});