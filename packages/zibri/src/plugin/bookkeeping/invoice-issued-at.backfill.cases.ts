import { describe, expect, it } from '@jest/globals';

import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { OmitStrict } from '../../types/omit-strict.type';
import { ApprovalRequestDetails } from '../approval/models/approval-request-details.model';
import { BankMatchTargetType } from '../bank/models/bank-match-target-type.enum';
import { InvoiceWriteObserver } from '../invoicing/invoice.write-observer';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { InvoiceDocument } from '../invoicing/models/invoice-document.model';
import { InvoiceType } from '../invoicing/models/invoice-type.enum';
import { Invoice } from '../invoicing/models/invoice.model';
import { type InvoiceCancellationServiceInterface } from '../invoicing/services/invoice-cancellation-service.interface';
import { createPostingBooks, createTransaction, itemOf, PostingBooks, suggest } from './bookkeeping-postings.cases';
import { day, inTenant, storeOf } from './bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { JournalEntry } from './models/journal-entry.model';
import { PostingSourceType } from './models/posting-source-type.enum';

/**
 * The cases every data source answers the same way about giving the invoices stored by 3.2, which had no `issuedAt`,
 * one at the upgrade. A file per data source runs them, with the entities, file stores and providers of the export
 * cases, which keep the books and archive the documents of the invoices issued, and the bookkeeping, the invoicing, the
 * approval and the bank plugin registered.
 */

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

const FIRST_NUMBER: string = '2026-SIEMEN-0001';
const DRAFT_NUMBER: string = 'TEMP-2026-SIEMEN-0002';
const FIRST_DATE: string = '2026-03-01T09:15:00.000Z';
const SECOND_DATE: string = '2026-03-02T09:15:00.000Z';

function invoices(): Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> {
    return inject(repositoryTokenFor(Invoice));
}

/**
 * Creates an invoice of 1,190.00, as 3.2 stored it without an `issuedAt`, or as this release issues it with one.
 * @param books - The books of the tenant.
 * @param number - The number.
 * @param date - When it is dated.
 * @param issuedAt - When it was issued, none for one of 3.2.
 * @returns The invoice.
 */
async function createInvoice(books: PostingBooks, number: string, date: string, issuedAt: Date | null): Promise<Invoice> {
    const ofThreeTwo: boolean = issuedAt == undefined && !number.startsWith('TEMP-');
    const created: Invoice = await inTenant(books.tenantId, async () => await invoices().create({
        // a final number without an issuedAt issues an invoice as it is written, which 3.2 did not do: written as a
        // draft, and given its number beneath the observers of the writes, the way 3.2 left it
        number: ofThreeTwo ? `TEMP-${number}` : number,
        currency: 'EUR',
        items: [itemOf(1000)],
        date: new Date(date),
        performanceDate: new Date(date),
        dueDate: new Date(date),
        customerAddressData: siemens,
        textBeforeItems: [],
        textAfterItems: [],
        issuedAt
    }));
    if (!ofThreeTwo) {
        return created;
    }
    await storeOf(inject<Repository<Invoice>>(repositoryTokenFor(Invoice))).updateAll({ where: { id: created.id }, data: { number } });
    return { ...created, number };
}

async function backfill(): Promise<number> {
    return await inject(InvoiceWriteObserver).backfillIssuedAt();
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeIssuedAtBackfill(dataSourceName: string): void {
    describe(`giving the invoices of 3.2 their issuedAt on ${dataSourceName}`, () => {
        it('gives each invoice with a final number and none its date, posting and archiving nothing, and does so once', async () => {
            const books: PostingBooks = await createPostingBooks();
            const old: Invoice = await createInvoice(books, FIRST_NUMBER, FIRST_DATE, null);
            const draft: Invoice = await createInvoice(books, DRAFT_NUMBER, SECOND_DATE, null);
            const issued: Invoice = await createInvoice(
                books,
                '2026-SIEMEN-0003',
                '2026-03-03T09:15:00.000Z',
                new Date('2026-03-03T10:00:00.000Z')
            );
            const entries: () => Promise<number> = async () => await inTenant(
                books.tenantId,
                async () => await inject<Repository<JournalEntry>>(repositoryTokenFor(JournalEntry)).count()
            );
            const documents: () => Promise<string[]> = async () => (await inTenant(
                books.tenantId,
                async () => await inject<Repository<InvoiceDocument>>(repositoryTokenFor(InvoiceDocument)).findAll({ limit: 'all' })
            )).map(d => d.invoiceId);
            const before: [number, string[]] = [await entries(), await documents()];
            // the one invoice issued with this release is posted and archived as it is issued
            expect(before).toEqual([1, [issued.id]]);

            expect(await backfill()).toBe(1);

            const read: Invoice[] = await inTenant(
                books.tenantId,
                async () => await invoices().findAll({ order: { number: 'ASC' }, limit: 'all' })
            );
            expect(read.map(i => [i.number, i.issuedAt?.toISOString() ?? null])).toEqual([
                [FIRST_NUMBER, FIRST_DATE],
                ['2026-SIEMEN-0003', '2026-03-03T10:00:00.000Z'],
                [DRAFT_NUMBER, null]
            ]);
            expect([await entries(), await documents()]).toEqual(before);
            expect(await inTenant(
                books.tenantId,
                async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE).findEntryOf(PostingSourceType.INVOICE, old.id)
            )).toBeUndefined();
            // again, as on the next start
            expect(await backfill()).toBe(0);
            expect((await inTenant(books.tenantId, async () => await invoices().findById(draft.id))).issuedAt).toBeNull();
        });

        it('issues an invoice written with a final number and no issuedAt on its date, posting and archiving it', async () => {
            const books: PostingBooks = await createPostingBooks();
            const write: (data: Partial<Invoice>) => OmitStrict<Invoice, 'id' | 'tenantId'> = data => ({
                number: 'TEMP-2026-SIEMEN-0001',
                currency: 'EUR',
                items: [itemOf(1000)],
                date: new Date(FIRST_DATE),
                performanceDate: new Date(FIRST_DATE),
                dueDate: new Date('2026-03-15T09:15:00.000Z'),
                customerAddressData: siemens,
                textBeforeItems: [],
                textAfterItems: [],
                ...data
            });
            const findEntry: (invoice: Invoice) => Promise<JournalEntry | undefined> = async invoice => await inTenant(
                books.tenantId,
                async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE)
                    .findEntryOf(PostingSourceType.INVOICE, invoice.id)
            );
            const findDocument: (invoice: Invoice) => Promise<InvoiceDocument | undefined> = async invoice => await inTenant(
                books.tenantId,
                async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE).findDocument(invoice.id)
            );

            const created: Invoice = await inTenant(books.tenantId, async () => await invoices().create(write({ number: FIRST_NUMBER })));
            const draft: Invoice = await inTenant(
                books.tenantId,
                async () => await invoices().create(write({ number: DRAFT_NUMBER }))
            );

            expect(created.issuedAt?.toISOString()).toBe(FIRST_DATE);
            expect([await findEntry(created) != undefined, await findDocument(created) != undefined]).toEqual([true, true]);
            expect([draft.issuedAt ?? null, await findEntry(draft), await findDocument(draft)]).toEqual([null, undefined, undefined]);

            // a draft given its final number is issued by the same write
            const numbered: Invoice = await inTenant(
                books.tenantId,
                async () => await invoices().updateById(draft.id, { number: '2026-SIEMEN-0002' })
            );

            expect(numbered.issuedAt?.toISOString()).toBe(FIRST_DATE);
            expect([await findEntry(numbered) != undefined, await findDocument(numbered) != undefined]).toEqual([true, true]);
        });

        it('lets an invoice of 3.2 be credited and suggested for a match once it has its issuedAt', async () => {
            const books: PostingBooks = await createPostingBooks();
            const paid: Invoice = await createInvoice(books, FIRST_NUMBER, FIRST_DATE, null);
            const credited: Invoice = await createInvoice(books, '2026-SIEMEN-0002', SECOND_DATE, null);
            const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
                ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
            );
            await expect(inTenant(books.tenantId, async () => await cancellations.cancelInvoice(credited.id, { date: day('2026-03-10') })))
                .rejects.toThrow('The invoice 2026-SIEMEN-0002 is not issued, and a draft is deleted rather than credited.');

            await backfill();

            const creditNote: Invoice = await inTenant(
                books.tenantId,
                async () => await cancellations.cancelInvoice(credited.id, { date: day('2026-03-10') })
            );
            expect([creditNote.type, creditNote.number]).toEqual([InvoiceType.CREDIT_NOTE, '2026-SIEMEN-0002-C1']);
            const payment: Awaited<ReturnType<typeof createTransaction>> = await createTransaction(books, '1190', {
                counterpartyName: 'SIEMENS AG',
                counterpartyIban: null,
                remittanceInformation: 'Invoice 2026-SIEMEN-0001'
            });
            const suggestions: ApprovalRequestDetails[] = await suggest(books, payment);
            expect(suggestions.map(s => s.request.input))
                .toEqual([expect.objectContaining({ targetType: BankMatchTargetType.INVOICE, targetId: paid.id })]);
        });
    });
}