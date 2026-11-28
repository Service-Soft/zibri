/* eslint-disable cspell/spellchecker */
/* eslint-disable sonar/no-duplicate-string -- the invoice numbers and days are the data each case finds the invoices by */
import { describe, expect, it } from '@jest/globals';

import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { type PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { BigNumber } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { INVOICE_PAYMENT_SOURCE_DI_VARIANT, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceAddress } from './models/invoice-address.model';
import { type InvoiceFilter } from './models/invoice-filter.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { NumberInvoices } from './models/number-invoices.model';
import { type InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { type InvoicePaymentSourceInterface } from './services/invoice-payment-source.interface';

/**
 * The cases every data source answers the same way about finding the invoices of the invoicing plugin: by a search,
 * whether they are issued, their type, and whether something of them is open. A file per data source runs them, with
 * {@link invoiceListTestEntities} and {@link invoiceListTestProviders} registered, and the invoicing plugin.
 */

/**
 * The entities the cases need, besides those of a test server.
 */
export const invoiceListTestEntities: Newable<BaseEntity>[] = [Invoice, NumberInvoices, InvoiceRecipientAbbreviation];

/**
 * What the payments of the cases paid of each invoice, by its id.
 */
const PAID: Map<string, BigNumber> = new Map();

/**
 * The payments an application records itself, such as those of a shop, as a payment source of the invoices.
 */
class RecordedPaymentSource implements InvoicePaymentSourceInterface {

    async resolvePaidAmounts(invoices: Invoice[]): Promise<Map<string, BigNumber>> {
        return await Promise.resolve(new Map(invoices.flatMap(i => {
            const paid: BigNumber | undefined = PAID.get(i.id);
            return paid == undefined ? [] : [[i.id, paid]];
        })));
    }
}

/**
 * The providers of the cases: every tenant issues its invoices as one company, and the payments of the cases are a
 * payment source of the invoices.
 */
export const invoiceListTestProviders: DiProvider<unknown>[] = [
    defineProvider<InvoicePaymentSourceInterface>({
        token: new InjectionToken<InvoicePaymentSourceInterface>('test.recorded_payment_source'),
        useValue: new RecordedPaymentSource(),
        variants: [INVOICE_PAYMENT_SOURCE_DI_VARIANT]
    }),
    companyInfoProvider(() => ({
        name: 'Example Company',
        fullName: 'Example Company LLC',
        email: 'info@example-company.com',
        phone: '12345 67890123',
        timezone: 'Europe/Berlin',
        address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
        taxNumber: '123/456/78910',
        vatNumber: 'DE123456789',
        ceo: 'James Smith',
        iban: 'DE75512108001245126199',
        bic: 'ABCDDEFFXXX'
    }))
];

const siemens: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'Siemens AG',
    countryId: 'DE'
};

const mustermann: InvoiceAddress = {
    ...siemens,
    company: false,
    companyName: null,
    formOfAddress: 'Mr',
    firstName: 'Max',
    lastName: 'Mustermann'
};

async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

function cancellations(): InvoiceCancellationServiceInterface<Invoice> {
    return inject<InvoiceCancellationServiceInterface<Invoice>>(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE);
}

/**
 * Creates an invoice of one item of 100.00 at 19 %, of 119.00.
 * @param tenantId - The tenant.
 * @param number - Its number.
 * @param day - Its day, such as `2026-03-01`.
 * @param data - What differs, such as the customer or that it is a draft.
 * @returns The invoice.
 */
async function createInvoice(tenantId: string, number: string, day: string, data: Partial<Invoice> = {}): Promise<Invoice> {
    return await inTenant(tenantId, async () => await inject<Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>>(
        repositoryTokenFor(Invoice)
    ).create({
        number,
        currency: 'EUR',
        items: [
            {
                name: 'Consulting',
                amount: 1,
                amountUnit: { code: 'HUR', displayName: 'Hours' },
                vat: { categoryCode: 'S', rate: 19 },
                price: 100
            }
        ],
        date: new Date(`${day}T12:00:00.000Z`),
        performanceDate: new Date(`${day}T12:00:00.000Z`),
        dueDate: new Date(`${day}T12:00:00.000Z`),
        customerAddressData: siemens,
        textBeforeItems: [],
        textAfterItems: [],
        issuedAt: new Date(),
        ...data
    }));
}

async function findInvoices(
    tenantId: string,
    filter: InvoiceFilter,
    page: number = 1,
    limit: number = 10
): Promise<PaginationResult<Invoice>> {
    return await inTenant(
        tenantId,
        async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_SERVICE).findInvoices(page, limit, filter)
    );
}

async function findNumbers(tenantId: string, filter: InvoiceFilter): Promise<string[]> {
    return (await findInvoices(tenantId, filter)).items.map(i => i.number);
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeInvoiceList(dataSourceName: string): void {
    describe(`finding the invoices on ${dataSourceName}`, () => {
        it('finds the invoices by their number or the name of their customer, whatever its case, the latest day first', async () => {
            const tenantId: string = UUIDUtilities.generate();
            await createInvoice(tenantId, '2026-SIEMEN-0001', '2026-03-01');
            await createInvoice(tenantId, '2026-SIEMEN-0002', '2026-03-02');
            await createInvoice(tenantId, '2026-MUSTER-0001', '2026-03-03', { customerAddressData: mustermann });
            await createInvoice(tenantId, '100%-0001', '2026-03-04', { customerAddressData: mustermann });

            expect(await findNumbers(tenantId, {})).toEqual(['100%-0001', '2026-MUSTER-0001', '2026-SIEMEN-0002', '2026-SIEMEN-0001']);
            expect(await findNumbers(tenantId, { search: 'siemen-0002' })).toEqual(['2026-SIEMEN-0002']);
            expect(await findNumbers(tenantId, { search: 'siemens' })).toEqual(['2026-SIEMEN-0002', '2026-SIEMEN-0001']);
            expect(await findNumbers(tenantId, { search: ' musterMANN ' })).toEqual(['100%-0001', '2026-MUSTER-0001']);
            expect(await findNumbers(tenantId, { search: 'max' })).toEqual(['100%-0001', '2026-MUSTER-0001']);
            // a % of the search is the character, not any text
            expect(await findNumbers(tenantId, { search: '0%-' })).toEqual(['100%-0001']);
            expect(await findNumbers(tenantId, { search: '' })).toHaveLength(4);
        });

        it('narrows to the issued invoices or the drafts and to a type, and pages them, counting every one', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const issued: Invoice = await createInvoice(tenantId, '2026-SIEMEN-0001', '2026-03-01');
            await createInvoice(tenantId, 'TEMP-2026-SIEMEN-0002', '2026-03-02', { issuedAt: null });
            await inTenant(tenantId, async () => await cancellations().cancelInvoice(issued.id));

            expect(await findNumbers(tenantId, { issued: false })).toEqual(['TEMP-2026-SIEMEN-0002']);
            expect((await findNumbers(tenantId, { issued: true })).sort()).toEqual(['2026-SIEMEN-0001', '2026-SIEMEN-0001-C1']);
            expect(await findNumbers(tenantId, { type: InvoiceType.CREDIT_NOTE })).toEqual(['2026-SIEMEN-0001-C1']);
            expect((await findNumbers(tenantId, { type: InvoiceType.INVOICE, search: 'siemen' })).sort())
                .toEqual(['2026-SIEMEN-0001', 'TEMP-2026-SIEMEN-0002']);
            const second: PaginationResult<Invoice> = await findInvoices(tenantId, { type: InvoiceType.INVOICE }, 2, 1);
            expect([second.totalAmount, second.items.map(i => i.number)]).toEqual([2, ['2026-SIEMEN-0001']]);
        });

        it('narrows to the invoices with something left to pay, or with nothing, after their credit notes and payments', async () => {
            const tenantId: string = UUIDUtilities.generate();
            await createInvoice(tenantId, '2026-SIEMEN-0001', '2026-03-01');
            const paid: Invoice = await createInvoice(tenantId, '2026-SIEMEN-0002', '2026-03-02');
            const partly: Invoice = await createInvoice(tenantId, '2026-SIEMEN-0003', '2026-03-03');
            const cancelled: Invoice = await createInvoice(tenantId, '2026-SIEMEN-0004', '2026-03-04');
            await createInvoice(tenantId, 'TEMP-2026-SIEMEN-0005', '2026-03-05', { issuedAt: null });
            PAID.set(paid.id, new BigNumber('119'));
            PAID.set(partly.id, new BigNumber('100'));
            await inTenant(tenantId, async () => await cancellations().cancelInvoice(cancelled.id));

            const open: PaginationResult<Invoice> = await findInvoices(tenantId, { open: true });

            // the credit note is neither: it pays nothing
            expect([open.totalAmount, open.items.map(i => i.number)])
                .toEqual([3, ['TEMP-2026-SIEMEN-0005', '2026-SIEMEN-0003', '2026-SIEMEN-0001']]);
            expect(await findNumbers(tenantId, { open: false })).toEqual(['2026-SIEMEN-0004', '2026-SIEMEN-0002']);
            expect(await findNumbers(tenantId, { open: true, issued: true, search: '0001' })).toEqual(['2026-SIEMEN-0001']);
            expect((await findInvoices(tenantId, { open: true, type: InvoiceType.CREDIT_NOTE })).totalAmount).toBe(0);
            const second: PaginationResult<Invoice> = await findInvoices(tenantId, { open: true, issued: true }, 2, 1);
            expect([second.totalAmount, second.items.map(i => i.number)]).toEqual([2, ['2026-SIEMEN-0001']]);
        });

        it('finds the invoices of the active tenant alone', async () => {
            const tenantId: string = UUIDUtilities.generate();
            await createInvoice(tenantId, '2026-SIEMEN-0001', '2026-03-01');

            expect((await findInvoices(UUIDUtilities.generate(), { search: 'siemen' })).totalAmount).toBe(0);
            expect((await findInvoices(UUIDUtilities.generate(), { open: true })).totalAmount).toBe(0);
        });
    });
}