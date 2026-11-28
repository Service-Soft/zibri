import { AsyncLocalStorage } from 'node:async_hooks';

import type { ZibriApplication } from '../../application/application';
import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { FrameworkColumnUtilities } from '../../data-source/migration/framework-column.utilities';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { EntityWrite, EntityWriteObserver, ObservedWrite, RowWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { FilterUtilities } from '../../routing/filter/filter.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { TenantDeletion } from '../../tenancy/tenant-definition/tenant-deletion.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { INVOICE_POSTING_DI_VARIANT, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { type InvoicingOptions } from './models/invoicing-options.model';
import { type InvoicePostingInterface } from './services/invoice-posting.interface';

/**
 * Keeps invoices as they were issued, however the repository got to the write: an invoice a credit note references
 * is neither changed nor deleted, and with `issuedInvoicesReadOnly` neither is one that is issued. Deleting the
 * tenant of either deletes it. Archives the documents of every invoice a write issues, with the `archive` of the
 * options, and hands it to the postings of `INVOICE_POSTING_DI_VARIANT`, such as the bookkeeping plugin, in the
 * transaction of the write.
 */
// here rather than in the cancellation service, which an application may replace: the reference of a credit note
// holds whatever service created it
@Injectable({ register: 'onUse' })
export class InvoiceWriteObserver implements EntityWriteObserver, OnAppInit {
    /**
     * What an invoice removed, or changed by a write to every invoice a filter matches, is read with. With a posting
     * registered, also its id, which the invoice issued is read again by. Its date, which an invoice given a final
     * number by such a write is issued on.
     */
    properties: string[] = ['tenantId', 'number', 'issuedAt', 'date'];

    /**
     * Whether the application deletes tenants, keeping how far a deletion got in `TenantDeletion`.
     */
    private deletesTenants: boolean = false;

    /**
     * The postings registered with `INVOICE_POSTING_DI_VARIANT`, none without bookkeeping.
     */
    private postings: InvoicePostingInterface[] = [];

    /**
     * Set while {@link backfillIssuedAt} writes, whose writes this observer lets through as they are.
     */
    private readonly backfilling: AsyncLocalStorage<true> = new AsyncLocalStorage();

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        private readonly options: InvoicingOptions
    ) {}

    /**
     * Registers itself as an observer of every write to an invoice, and gives the invoices issued before there was an
     * `issuedAt` one, see {@link backfillIssuedAt}.
     * @param app - The application that starts.
     * @throws An InternalError when a provider of `INVOICE_POSTING_DI_VARIANT` holds no posting.
     */
    async onAppInit(app: ZibriApplication): Promise<void> {
        this.deletesTenants = app.options.dataSources.some(d => inject(d).entities.includes(TenantDeletion));
        this.postings = getRegisteredProvidersOfVariant(INVOICE_POSTING_DI_VARIANT).map(provider => {
            const posting: unknown = inject(provider.token);
            if (!this.isPosting(posting)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as an invoice posting, and needs to be one.`);
            }
            return posting;
        });
        if (this.handlesIssued()) {
            FrameworkColumnUtilities.validatePresent('Booking or archiving issued invoices', Invoice, 'issuedAt');
            this.properties = ['id', ...this.properties];
        }
        if (this.options.issuedInvoicesReadOnly === true) {
            FrameworkColumnUtilities.validatePresent('issuedInvoicesReadOnly of the invoicing options', Invoice, 'issuedAt');
        }
        inject(EntityWriteObserverRegistry).register(Invoice, this);
        // without the column, of a schema the data source does not manage, no invoice is issued, as in 3.2
        if (FrameworkColumnUtilities.hasColumns(Invoice, 'issuedAt')) {
            await this.backfillIssuedAt();
        }
    }

    /**
     * Gives every invoice and credit note of every tenant that has a final number and no `issuedAt` its `date` as its
     * `issuedAt`: those stored before there was an `issuedAt`, which were issued once they had a final number, and those
     * an instance of 3.2 stores during a rolling deploy. Written past this observer, so such an invoice is neither
     * posted, archived nor refused as read only by it. Runs on every start, and changes nothing once every such invoice
     * has one.
     * @returns How many invoices it gave an `issuedAt`.
     */
    // as the counters without a scope are given theirs by InvoiceNumberService.onAppInit, every start: a row of 3.2 is
    // told by what it lacks, which an instance of 3.2 keeps writing until the deploy is done. The date rather than the
    // start of its day: it is the moment 3.2 set the invoice to by default, so it is the best record of its issue
    async backfillIssuedAt(): Promise<number> {
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const draft: string = `${FilterUtilities.escapeLike(`TEMP${this.options.separator}`)}%`;
        const issued: Pick<Invoice, 'id' | 'date'>[] = [];
        for await (const row of invoices.stream({
            where: { issuedAt: null, number: { notLike: draft } },
            select: { id: true, date: true },
            acrossTenants: true
        })) {
            issued.push(row);
        }
        await this.backfilling.run(true, async () => await PromiseUtilities.allChunked(
            issued,
            async row => await invoices.updateById(row.id, { issuedAt: row.date }, { acrossTenants: true })
        ));
        return issued.length;
    }

    /**
     * Whether a write needs a transaction: one that may issue an invoice, with a posting registered or the documents
     * of issued invoices archived, which happens in the transaction of the write so that a write that fails posts and
     * archives nothing.
     * @param write - The write.
     * @returns True for a write naming an `issuedAt` or a final number, with a posting registered or `archive` set.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return !this.isPassedThrough()
            && this.handlesIssued()
            && write.operation !== 'remove'
            && write.data.some(row => Reflect.get(row, 'issuedAt') != undefined || this.isFinalNumber(Reflect.get(row, 'number')));
    }

    /**
     * Refuses a write that changes or removes an invoice a credit note references, or with
     * `issuedInvoicesReadOnly` one that is issued, unless it removes the invoices of a tenant that is deleted. Gives
     * every invoice a write leaves with a final number and no `issuedAt` its `date` as its `issuedAt`, so that it is
     * issued, and archives the documents of the invoices a write that is not refused issues, and posts them.
     * @param write - The write about to be made.
     * @throws A ConflictError naming the first invoice it would change, or one it would leave with a final number that
     * it cannot give an `issuedAt`, and what rendering the documents of an invoice or a posting refuses the invoices
     * with.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        if (this.isPassedThrough()) {
            return;
        }
        if (write.operation !== 'insert') {
            await this.validateChange(write);
        }
        // without the column, of a schema the data source does not manage, a final number issues nothing, as in 3.2
        if (write.operation !== 'remove' && FrameworkColumnUtilities.hasColumns(Invoice, 'issuedAt')) {
            await this.issueFinalNumbers(write);
        }
        if (this.handlesIssued() && write.operation !== 'remove') {
            await this.handleIssued(write);
        }
    }

    /**
     * Gives every invoice a write leaves with a final number and no `issuedAt` its `date` as its `issuedAt`, in what the
     * write writes, so that a final number means the invoice is issued, however it is written.
     * @param write - The write about to be made, which is no removal.
     * @throws A ConflictError for such an invoice the write cannot give its own `issuedAt`: one of a write to every row
     * a filter matches, which writes the same values to all of them, or one updated as it is upserted.
     */
    private async issueFinalNumbers(write: ObservedWrite): Promise<void> {
        // a write naming no final number of an invoice of 3.2 that has none, posting or archiving without the transaction
        // it would need: the start-up backfill gives that invoice its issuedAt, as every invoice written since has one
        if (write.transaction == undefined && this.handlesIssued()) {
            return;
        }
        const rowWrites: RowWrite[] = await write.resolveRowWrites();
        for (const rowWrite of rowWrites) {
            if (rowWrite.data == undefined) {
                continue;
            }
            const resulting: object = { ...rowWrite.existing, ...rowWrite.data };
            const invoiceNumber: unknown = Reflect.get(resulting, 'number');
            if (typeof invoiceNumber !== 'string' || !this.isFinalNumber(invoiceNumber) || Reflect.get(resulting, 'issuedAt') != undefined) {
                continue;
            }
            const written: object | undefined = this.findWrittenRow(write, rowWrite, rowWrites.length);
            if (written == undefined) {
                throw new ConflictError(
                    $ts`The invoice ${invoiceNumber} has a final number, and needs an issuedAt: name it, or write the invoice by its id.`
                );
            }
            const date: unknown = Reflect.get(resulting, 'date');
            // a date left to the default of the repository, which is the moment it is written
            const issuedAt: Date = date instanceof Date ? date : new Date();
            Reflect.set(written, 'issuedAt', issuedAt);
            Reflect.set(rowWrite.data, 'issuedAt', issuedAt);
        }
    }

    /**
     * Finds what a write writes into one row, which it writes for that row alone.
     * @param write - The write.
     * @param rowWrite - What it does to the row.
     * @param rowCount - How many rows it writes.
     * @returns The values written, or undefined when they are written to other rows as well.
     */
    private findWrittenRow(write: ObservedWrite, rowWrite: RowWrite, rowCount: number): object | undefined {
        switch (write.operation) {
            case 'insert':
            case 'save': {
                // the rows themselves
                return rowWrite.data;
            }
            case 'upsert': {
                // what a row is created with, and not what it is set to as it is there already, a copy of that
                return rowWrite.existing == undefined ? rowWrite.data : undefined;
            }
            case 'updateEach': {
                // a row naming the id of the one it updates, or the one row without an id of a write updating one row
                const id: unknown = Reflect.get(rowWrite.existing ?? {}, 'id');
                const named: object | undefined = write.data.find(row => Reflect.get(row, 'id') === id);
                const unnamed: object[] = write.data.filter(row => Reflect.get(row, 'id') == undefined);
                return named ?? (rowCount === 1 ? unnamed.at(-1) : undefined);
            }
            case 'updateAll': {
                // the values written to every row matched, which are those of the one row when it matches one: a
                // row is read by its number among the properties, which is unique among the invoices of its tenant
                return rowCount === 1 ? write.data[0] : undefined;
            }
            case 'remove': {
                return undefined;
            }
        }
    }

    /**
     * Whether a write is let through as it is: one of the backfill, giving the invoices of before the issue date they
     * had, and one of a restore, bringing back the invoices as they were stored, beside the entries and documents of
     * their issue, which it brings back or keeps.
     * @returns True for such a write.
     */
    private isPassedThrough(): boolean {
        return this.backfilling.getStore() === true || RestoreContextUtilities.isRestoring();
    }

    private isFinalNumber(value: unknown): boolean {
        return typeof value === 'string' && !value.startsWith(`TEMP${this.options.separator}`);
    }

    /**
     * Whether something happens to an invoice as it is issued: a posting registered, or its documents archived.
     * @returns True when it does.
     */
    private handlesIssued(): boolean {
        return this.postings.length > 0 || this.options.archive != undefined;
    }

    /**
     * Archives the documents of the invoices a write issues, and hands them to every posting registered: those it
     * creates with an `issuedAt`, and those it gives one that had none, each as it is once written.
     * @param write - The write about to be made.
     */
    private async handleIssued(write: ObservedWrite): Promise<void> {
        const issuing: RowWrite[] = (await write.resolveRowWrites()).filter(rowWrite => rowWrite.data != undefined
            && Reflect.get(rowWrite.data, 'issuedAt') != undefined
            && (rowWrite.existing == undefined || Reflect.get(rowWrite.existing, 'issuedAt') == undefined));
        if (!issuing.length) {
            return;
        }
        // read whole, as a write to every row a filter matches knows them by the properties above alone
        const ids: string[] = issuing.flatMap(rowWrite => rowWrite.existing == undefined ? [] : [String(Reflect.get(rowWrite.existing, 'id'))]);
        const stored: Invoice[] = ids.length
            ? await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).findAll({
                where: { id: { oneOf: ids } },
                acrossTenants: true,
                transaction: write.transaction,
                limit: 'all'
            })
            : [];
        const invoices: Invoice[] = issuing.map(rowWrite => Object.assign(
            new Invoice(),
            rowWrite.existing == undefined ? undefined : stored.find(s => s.id === Reflect.get(rowWrite.existing ?? {}, 'id')),
            rowWrite.data
        ));
        // every write issuing an invoice has one, since requiresTransaction has the driver start it for one without
        if (write.transaction == undefined) {
            throw new InternalError('An invoice issued is posted and archived in the transaction of its write, and the write has none.');
        }
        // archived first: an invoice whose documents cannot be rendered is not issued, and so not posted either
        await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE).archiveIssuedInvoices(invoices, write.transaction);
        // one after the other, as the writes of one transaction run over one connection
        for (const posting of this.postings) {
            await posting.postIssuedInvoices(invoices, write.transaction);
        }
    }

    private isPosting(value: unknown): value is InvoicePostingInterface {
        return typeof value === 'object'
            && value != undefined
            && 'postIssuedInvoices' in value
            && typeof value.postIssuedInvoices === 'function';
    }

    /**
     * Refuses a write that changes or removes an invoice a credit note references, or with
     * `issuedInvoicesReadOnly` one that is issued, unless it removes the invoices of a tenant that is deleted.
     * @param write - The write about to be made, which is no insert.
     * @throws A ConflictError naming the first invoice it would change.
     */
    private async validateChange(write: ObservedWrite): Promise<void> {
        // every row written that is there already, whatever is written to it: a write to every row a filter
        // matches reads the rows as the properties above alone, which says nothing of whether a value differs
        const changed: object[] = (await write.resolveRowWrites()).flatMap(rowWrite => rowWrite.existing ?? []);
        if (!changed.length) {
            return;
        }
        const issued: object | undefined = this.options.issuedInvoicesReadOnly === true
            ? changed.find(row => Reflect.get(row, 'issuedAt') != undefined)
            : undefined;
        const referenced: [string, string] | undefined = issued == undefined
            ? await this.findCreditNoteReference(changed, write.transaction)
            : undefined;
        if (issued == undefined && referenced == undefined) {
            return;
        }
        if (write.operation === 'remove' && await this.isTenantDeletion(changed)) {
            return;
        }
        if (issued != undefined) {
            const invoiceNumber: string = String(Reflect.get(issued, 'number'));
            throw new ConflictError(
                $ts`The invoice ${invoiceNumber} is issued, and cannot be changed or deleted. A credit note corrects it.`
            );
        }
        if (referenced != undefined) {
            const [invoiceNumber, creditNoteNumber] = referenced;
            throw new ConflictError(
                $ts`The invoice ${invoiceNumber} is referenced by the credit note ${creditNoteNumber}, and cannot be changed or deleted.`
            );
        }
    }

    /**
     * Finds a credit note referencing one of the given invoices, in their own tenants.
     * @param invoices - The invoices.
     * @param transaction - The transaction of the write, if any.
     * @returns The number of the invoice referenced and of the credit note, or undefined.
     */
    private async findCreditNoteReference(
        invoices: object[],
        transaction: RepositoryTransaction | undefined
    ): Promise<[string, string] | undefined> {
        // a table without them, of a schema the data source does not manage, holds no credit note
        if (!FrameworkColumnUtilities.hasColumns(Invoice, 'type', 'precedingInvoices')) {
            return undefined;
        }
        const numbersByTenant: Map<string, string[]> = new Map();
        for (const invoice of invoices) {
            const tenantId: string = String(Reflect.get(invoice, 'tenantId'));
            numbersByTenant.set(tenantId, [...numbersByTenant.get(tenantId) ?? [], String(Reflect.get(invoice, 'number'))]);
        }
        const repository: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const creditNote: Invoice | undefined = await repository.findOne({
            where: [...numbersByTenant].map(([tenantId, numbers]) => ({
                tenantId,
                type: InvoiceType.CREDIT_NOTE,
                precedingInvoices: { where: { number: { oneOf: numbers } } }
            })),
            acrossTenants: true,
            transaction,
            required: false
        });
        if (creditNote == undefined) {
            return undefined;
        }
        const numbers: string[] = numbersByTenant.get(creditNote.tenantId) ?? [];
        const reference: string = creditNote.precedingInvoices?.find(p => numbers.includes(p.number))?.number ?? '';
        return [reference, creditNote.number];
    }

    /**
     * Whether the tenant of every given invoice is being deleted.
     * @param invoices - The invoices removed.
     * @returns True when it is.
     */
    private async isTenantDeletion(invoices: object[]): Promise<boolean> {
        if (!this.deletesTenants) {
            return false;
        }
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const tenantIds: string[] = [...new Set(invoices.map(invoice => String(Reflect.get(invoice, 'tenantId'))))];
        for (const tenantId of tenantIds) {
            const deletion: TenantDeletion | undefined = await tenantService.findTenantDeletion?.(tenantId);
            if (deletion == undefined || deletion.finishedAt != undefined) {
                return false;
            }
        }
        return true;
    }
}