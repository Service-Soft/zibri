/* eslint-disable cspell/spellchecker */
import assert from 'node:assert';

import { describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';

import { S3StandIn } from '../../__testing__/backup/s3-stand-in.model';
import { testFileFolder } from '../../__testing__/constants';
import { waitUntil } from '../../__testing__/wait-until.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { BackupEntity } from '../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { type BackupServiceInterface } from '../../backup/backup-service.interface';
import { BackupTransport } from '../../backup/decorators/backup-transport.decorator';
import { KeptRowDivergenceReason } from '../../backup/kept-row-divergence-reason.enum';
import { type KeptRowDivergence } from '../../backup/kept-row-divergence.model';
import { S3TenantBackupTransportKind } from '../../backup/tenant/s3.tenant-backup-transport-kind';
import { TenantBackupSettings } from '../../backup/tenant/tenant-backup-settings.model';
import { TenantBackupTransport } from '../../backup/tenant/tenant-backup-transport.model';
import { FsBackupTransport } from '../../backup/transports/fs.backup-transport';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank/bank.tokens';
import { BankTransactionState } from '../bank/models/bank-transaction-state.model';
import { type BankTransaction } from '../bank/models/bank-transaction.model';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { InvoiceDocument } from '../invoicing/models/invoice-document.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { exportTestEntities, exportTestProviders } from './bookkeeping-export.cases';
import { createPostingBooks, createTransaction, issueInvoice, itemOf, PostingBooks, rentOf, suggest } from './bookkeeping-postings.cases';
import { inTenant, journal } from './bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { ExpenseReceipt } from './models/expense-receipt.model';
import { Expense } from './models/expense.model';
import { JournalEntry } from './models/journal-entry.model';
import { type ExpenseServiceInterface } from './services/expense-service.interface';

/**
 * The cases every data source answers the same way about restoring the backup of a tenant that keeps books: the rows
 * come back as they were stored, and nothing is posted, archived or refused by it. A file per data source runs them,
 * with {@link restoreTestEntities} in a data source backed up to the {@link RestoreFsBackupTransport}, the file
 * stores of the postings, {@link restoreTestProviders}, the {@link restoreStandIn} started, and the bookkeeping, the
 * invoicing, the approval and the bank plugin registered.
 */

/**
 * The folder the backups of the application are kept in, which the cases take none of.
 */
export const restoreBackupFolder: FsPath = FsUtilities.getPath(testFileFolder, `bookkeeping-restore-backups-${UUIDUtilities.generate()}`);

/**
 * The storage of the tenants, which their backups are kept in.
 */
export const restoreStandIn: S3StandIn = new S3StandIn(
    FsUtilities.getPath(testFileFolder, `bookkeeping-restore-bucket-${UUIDUtilities.generate()}`)
);

const INVOICE_NUMBER: string = '2026-SIEMEN-0001';
const COUNTERPARTY_NAME: string = 'SIEMENS AG';

/**
 * The transport the data source of the cases is backed up with.
 */
@BackupTransport()
export class RestoreFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('bookkeeping-restore-fs', restoreBackupFolder);
    }
}

/**
 * The entities of the cases: those of the export, and those of the backups.
 */
export const restoreTestEntities: Newable<BaseEntity>[] = [
    ...exportTestEntities,
    BackupEntity,
    BackupResourceEntity,
    TenantBackupTransport,
    TenantBackupSettings
];

/**
 * The providers of the cases: those of the export, keeping the books and archiving the documents of the invoices, and
 * the storage of the tenants, which answers over plain http on this machine.
 */
export const restoreTestProviders: DiProvider<unknown>[] = [
    ...exportTestProviders,
    defineProvider({
        token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
        useValue: { kinds: [new S3TenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: true }
    })
];

function backups(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

/**
 * Takes a backup of a tenant, into a bucket of its own.
 * @param tenantId - The tenant.
 * @returns The backup.
 */
async function backUp(tenantId: string): Promise<BackupEntity> {
    const create: BackupServiceInterface['createTenantBackupTransport'] = backups().createTenantBackupTransport;
    assert(create, 'the backup service takes no transports of tenants');
    await create.call(backups(), tenantId, {
        name: 'own bucket',
        kind: 's3',
        settings: {
            endpoint: restoreStandIn.getEndpoint(),
            bucket: 'tenant-backups',
            region: 'us-east-1',
            accessKeyId: 'tenant-key',
            addressingStyle: 'path'
        },
        secret: { secretAccessKey: 'tenant-secret' }
    });
    const backup: BackupEntity = await backups().waitForBackup(await backups().queueBackup({ name: `books-${tenantId}`, tenantId }));
    await firstValueFrom(backups().isCreatingBackup.pipe(first(creating => !creating)));
    return backup;
}

/**
 * What the books of a tenant hold, as compared across a restore.
 */
type HeldBooks = {

    entries: string[],

    invoices: string[],

    documents: string[],

    expenses: string[],

    states: string[]
};

async function resolveHeld(books: PostingBooks): Promise<HeldBooks> {
    return await inTenant(books.tenantId, async () => ({
        entries: (await inject<Repository<JournalEntry>>(repositoryTokenFor(JournalEntry))
            .findAll({ order: { chainSequence: 'ASC' }, limit: 'all' }))
            .map(e => `${e.id} ${e.sequence} ${e.sourceType ?? ''} ${e.sourceId ?? ''}`),
        invoices: (await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).findAll({ order: { number: 'ASC' }, limit: 'all' }))
            .map(i => `${i.id} ${i.number} ${i.type ?? ''} ${i.issuedAt?.toISOString() ?? ''}`),
        documents: (await inject<Repository<InvoiceDocument>>(repositoryTokenFor(InvoiceDocument))
            .findAll({ order: { number: 'ASC' }, limit: 'all' }))
            .map(d => `${d.id} ${d.invoiceId} ${d.pdf}`),
        expenses: (await inject<Repository<Expense>>(repositoryTokenFor(Expense))
            .findAll({ order: { documentNumber: 'ASC' }, limit: 'all' }))
            .map(e => `${e.id} ${e.documentNumber} ${e.recordedAt?.toISOString() ?? ''} ${e.postedEntryId ?? ''}`),
        states: (await inject<Repository<BankTransactionState>>(repositoryTokenFor(BankTransactionState))
            .findAll({ order: { transactionId: 'ASC' }, limit: 'all' }))
            .map(s => `${s.transactionId} ${s.status} ${s.openAmount.toFixed(2)}`)
    }));
}

/**
 * Gives a draft of the cases its final number, which issues it.
 * @param books - The books.
 * @param draft - The draft, numbered `TEMP-` and its final number.
 */
async function giveFinalNumber(books: PostingBooks, draft: Invoice): Promise<void> {
    await inTenant(books.tenantId, async () => await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).updateById(
        draft.id,
        { number: draft.number.replace('TEMP-', '') }
    ));
}

/**
 * The rows of a tenant kept as they were written that no longer match the rows they were written from, as every check
 * a restore asks finds them.
 * @param books - The books of the tenant.
 * @returns The rows.
 */
async function findDivergences(books: PostingBooks): Promise<KeptRowDivergence[]> {
    return await inTenant(books.tenantId, async () => [
        ...await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE).resolveKeptRowDivergences(),
        ...await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE).resolveKeptRowDivergences(),
        ...await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).resolveKeptRowDivergences()
    ]);
}

/**
 * The events of the audit trail of a tenant about the rows a restore kept that no longer match.
 * @param books - The books of the tenant.
 * @returns The subject, the outcome and the reason of each.
 */
async function findDivergenceEvents(books: PostingBooks): Promise<string[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    const recorded: AuditEntry[] = await inject<Repository<AuditEntry>>(repositoryTokenFor(AuditEntry)).findAll({
        where: { action: AuditAction.TENANT_RESTORE_DIVERGENCE, tenantId: books.tenantId },
        acrossTenants: true,
        limit: 'all'
    });
    return recorded.map(e => `${e.subject ?? ''} ${e.outcome} ${e.reason ?? ''}`);
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeRestoreOfBooks(dataSourceName: string): void {
    describe(`restoring a tenant that keeps books on ${dataSourceName}`, () => {
        it('brings back its invoices, credit notes, expenses and bank states as they were, posting and archiving nothing', async () => {
            const books: PostingBooks = await createPostingBooks();
            const invoice: Invoice = await issueInvoice(books, INVOICE_NUMBER, [itemOf(1000)]);
            const cancelled: Invoice = await issueInvoice(books, '2026-SIEMEN-0002', [itemOf(100)]);
            await inTenant(books.tenantId, async () => {
                await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE)
                    .cancelInvoice(cancelled.id, { date: new Date('2026-03-10T12:00:00.000Z') });
                const expenseService: ExpenseServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
                const draft: Expense = await expenseService.createExpense(rentOf(books));
                await expenseService.recordExpense(draft.id);
            });
            // the payment of the invoice, which the bank plugin matches on its own
            const payment: BankTransaction = await createTransaction(books, '1190', {
                counterpartyName: COUNTERPARTY_NAME,
                counterpartyIban: null,
                remittanceInformation: `Invoice ${invoice.number}`
            });
            await suggest(books, payment);
            const backup: BackupEntity = await backUp(books.tenantId);
            const before: HeldBooks = await resolveHeld(books);
            expect(before.states).toEqual([`${payment.id} MATCHED 0.00`]);

            await backups().restore(backup);

            expect(await resolveHeld(books)).toEqual(before);
            expect((await inTenant(books.tenantId, async () => await journal().resolveVerification())).intact).toBe(true);
            // nothing kept that no longer matches
            expect(await findDivergences(books)).toEqual([]);
            expect(await findDivergenceEvents(books)).toEqual([]);
        });

        it('reports the rows it kept that no longer match, and lets a draft it brought back be issued again', async () => {
            const books: PostingBooks = await createPostingBooks();
            const draft: Invoice = await issueInvoice(books, 'TEMP-2026-SIEMEN-0002', [itemOf(100)], '2026-03-02');
            const backup: BackupEntity = await backUp(books.tenantId);
            // after the backup: an invoice issued, the draft issued, an expense recorded with its receipt, and a payment
            // of the invoice that the bank plugin matches on its own
            const issued: Invoice = await issueInvoice(books, INVOICE_NUMBER, [itemOf(1000)]);
            await giveFinalNumber(books, draft);
            const expense: Expense = await inTenant(books.tenantId, async () => {
                const expenseService: ExpenseServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
                const receipt: ExpenseReceipt = await expenseService.createReceipt({
                    name: 'rent.pdf',
                    mimeType: 'application/pdf',
                    data: Buffer.from('%PDF-1.4 rent')
                });
                return await expenseService.recordExpense(
                    (await expenseService.createExpense(rentOf(books, { receiptId: receipt.id }))).id
                );
            });
            const payment: BankTransaction = await createTransaction(books, '1190', {
                counterpartyName: COUNTERPARTY_NAME,
                counterpartyIban: null,
                remittanceInformation: `Invoice ${issued.number}`
            });
            await suggest(books, payment);

            await backups().restore(backup);

            const expected: string[] = [
                `BankMatch Invoice ${issued.id} ${KeptRowDivergenceReason.SOURCE_MISSING}`,
                `ExpenseReceipt Expense  ${KeptRowDivergenceReason.SOURCE_MISSING}`,
                `InvoiceDocument Invoice ${draft.id} ${KeptRowDivergenceReason.SOURCE_DRAFT}`,
                `InvoiceDocument Invoice ${issued.id} ${KeptRowDivergenceReason.SOURCE_MISSING}`,
                `JournalEntry Expense ${expense.id} ${KeptRowDivergenceReason.SOURCE_MISSING}`,
                `JournalEntry Invoice ${draft.id} ${KeptRowDivergenceReason.SOURCE_DRAFT}`,
                `JournalEntry Invoice ${issued.id} ${KeptRowDivergenceReason.SOURCE_MISSING}`
            ].sort();
            const found: KeptRowDivergence[] = await findDivergences(books);
            expect(found.map(d => `${d.entity} ${d.sourceEntity} ${d.sourceId ?? ''} ${d.reason}`).sort()).toEqual(expected);
            // one event per row in the audit trail of the tenant
            expect((await findDivergenceEvents(books)).sort())
                .toEqual(found.map(d => `${d.entity} ${d.id} ${AuditOutcome.FAILURE} ${AuditReason.DIVERGED}`).sort());

            // the draft issued again posts and archives nothing more: its entry and its documents are those kept
            const held: HeldBooks = await resolveHeld(books);
            await giveFinalNumber(books, draft);
            const after: HeldBooks = await resolveHeld(books);
            expect(after.entries).toEqual(held.entries);
            expect(after.documents).toEqual(held.documents);
            expect((await findDivergences(books)).filter(d => d.sourceId === draft.id)).toEqual([]);
        });

        it('recomputes the states of the transactions a restore keeps, from the matches it keeps', async () => {
            const books: PostingBooks = await createPostingBooks();
            await issueInvoice(books, INVOICE_NUMBER, [itemOf(1000)]);
            const backup: BackupEntity = await backUp(books.tenantId);
            // after the backup, which a restore keeps as it is: the transaction and its match are append only
            const payment: BankTransaction = await createTransaction(books, '1190', {
                counterpartyName: COUNTERPARTY_NAME,
                counterpartyIban: null,
                remittanceInformation: 'Invoice 2026-SIEMEN-0001'
            });
            await suggest(books, payment);
            const before: HeldBooks = await resolveHeld(books);
            expect(before.states).toEqual([`${payment.id} MATCHED 0.00`]);

            await backups().restore(backup);

            // the state of the backup had none of the transaction, and the one recomputed is that of its match
            await waitUntil(
                async () => JSON.stringify((await resolveHeld(books)).states) === JSON.stringify(before.states),
                5000,
                async () => JSON.stringify((await resolveHeld(books)).states)
            );
            expect((await resolveHeld(books)).entries).toEqual(before.entries);
        });
    });
}