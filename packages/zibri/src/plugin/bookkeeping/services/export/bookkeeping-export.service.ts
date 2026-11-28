import { AsyncLocalStorage } from 'node:async_hooks';
import { type Readable } from 'node:stream';

import { type ZibriApplication } from '../../../../application/application';
import { type BaseArchivedEntity } from '../../../../archive/base-archived-entity.model';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { type BaseEntity } from '../../../../entity/base-entity.model';
import { ConflictError } from '../../../../error-handling/errors/conflict.error';
import { type FileRecord } from '../../../../file/file-record.model';
import { type OnAppInit } from '../../../../global/on-app-init.interface';
import { $ts } from '../../../../localization/translate.function';
import { type Newable } from '../../../../types/newable.type';
import { BigNumber, NumberUtilities } from '../../../../utilities/number.utilities';
import { BankMatch } from '../../../bank/models/bank-match.model';
import { BankStatement } from '../../../bank/models/bank-statement.model';
import { BankTransaction } from '../../../bank/models/bank-transaction.model';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing/invoicing.tokens';
import { InvoiceDocument } from '../../../invoicing/models/invoice-document.model';
import { Invoice } from '../../../invoicing/models/invoice.model';
import { type InvoiceCalcServiceInterface } from '../../../invoicing/services/invoice-calc-service.interface';
import { BookkeepingDayUtilities } from '../../bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../../bookkeeping.tokens';
import { BookkeepingAccount } from '../../models/bookkeeping-account.model';
import { type BookkeepingExportArchive } from '../../models/bookkeeping-export-archive.model';
import { BookkeepingExportColumnType } from '../../models/bookkeeping-export-column-type.enum';
import { type BookkeepingExportColumn } from '../../models/bookkeeping-export-column.model';
import { type BookkeepingExportFile } from '../../models/bookkeeping-export-file.type';
import { type BookkeepingExportOptions } from '../../models/bookkeeping-export-options.model';
import { type BookkeepingExportTable } from '../../models/bookkeeping-export-table.model';
import { type BookkeepingExportValue } from '../../models/bookkeeping-export-value.type';
import { type BookkeepingSettings } from '../../models/bookkeeping-settings.model';
import { type BookkeepingVerification } from '../../models/bookkeeping-verification.model';
import { ExpenseReceipt } from '../../models/expense-receipt.model';
import { Expense } from '../../models/expense.model';
import { FiscalYearStatement } from '../../models/fiscal-year-statement.model';
import { FiscalYear } from '../../models/fiscal-year.model';
import { JournalEntryLine } from '../../models/journal-entry-line.model';
import { JournalEntry } from '../../models/journal-entry.model';
import { PostingSourceType } from '../../models/posting-source-type.enum';
import { type JournalServiceInterface } from '../journal-service.interface';
import { type BookkeepingExportServiceInterface } from './bookkeeping-export-service.interface';
import { type BookkeepingExporterInterface } from './bookkeeping-exporter.interface';

/**
 * The most rows read by their ids in one go.
 */
const CHUNK_SIZE: number = 500;

/**
 * The longest name of a document in its path, after the id of its row.
 */
const MAX_DOCUMENT_NAME_LENGTH: number = 100;

/**
 * The name of the table of the fiscal years.
 */
const FISCAL_YEARS_TABLE: string = 'fiscal-years';

/**
 * The name of the table of the journal entries.
 */
const JOURNAL_ENTRIES_TABLE: string = 'journal-entries';

/**
 * A document of the export, read from the archive once every table is written.
 */
type ExportedDocument = {
    /**
     * The archived row the file belongs to.
     */
    row: BaseArchivedEntity,
    /**
     * The id of the file.
     */
    fileId: string,
    /**
     * Its path in the export.
     */
    path: string
};

/**
 * Something that does not hold, as the export states it: a problem checking the books found, or a document that
 * could not be read unchanged.
 */
type ExportProblem = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    entryId: string | null,
    // eslint-disable-next-line jsdoc/require-jsdoc
    lineId: string | null,
    /**
     * The path of the document, or null for a problem of the books.
     */
    document: string | null,
    // eslint-disable-next-line jsdoc/require-jsdoc
    reason: string
};

/**
 * What the tables of an export learn while their rows are read, which the tables and documents after them read.
 */
type ExportState = {
    /**
     * The number of each account, by its id.
     */
    accountNumbers: Map<string, string>,
    /**
     * The ids of the entries written, whose lines are written.
     */
    entryIds: Set<string>,
    /**
     * The ids of what posted the entries, by the `sourceType` of the entries.
     */
    sources: Map<string, Set<string>>,
    /**
     * The documents the rows named.
     */
    documents: ExportedDocument[],
    /**
     * The documents that could not be read.
     */
    problems: ExportProblem[]
};

/**
 * Default implementation of the export service: reads a fiscal year of the current tenant table by table, and hands
 * it to the exporter of `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER`.
 */
@Injectable({ register: 'onUse' })
export class BookkeepingExportService implements BookkeepingExportServiceInterface, OnAppInit {
    /**
     * The entities the data sources of the application declare, which decide the tables of the posting sources.
     */
    private declared: Set<Newable<BaseEntity>> = new Set();

    // read when used, like the repositories of the journal service: ZibriBookkeepingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get journalService(): JournalServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE);
    }

    private get exporter(): BookkeepingExporterInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER);
    }

    /**
     * Finds out which plugins posting into the books the application declares the entities of.
     * @param app - The application that starts.
     */
    onAppInit(app: ZibriApplication): void {
        this.declared = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async exportFiscalYear(fiscalYearId: string, options: BookkeepingExportOptions = {}): Promise<BookkeepingExportArchive> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        const settings: BookkeepingSettings | undefined = await this.journalService.findSettings();
        if (settings == undefined) {
            throw new ConflictError($ts`The tenant keeps no books, as it has no bookkeeping settings.`);
        }
        // checked before anything is written, so that index.xml says what it found. A chain holds only as a whole, so
        // it is the chain of the tenant, every fiscal year of it
        const verification: BookkeepingVerification = await this.journalService.resolveVerification();
        const exportedAt: Date = new Date();
        const archive: BookkeepingExportArchive = this.exporter.resolveArchive({
            fiscalYear,
            settings,
            exportedAt,
            verification,
            files: this.resolveFiles(fiscalYear, settings, verification, exportedAt, options.documents ?? true)
        });
        return { ...archive, content: this.bindToContext(archive.content) };
    }

    /**
     * Reads the files of an export, in the order the exporter writes them.
     * @param fiscalYear - The fiscal year.
     * @param settings - The settings of the books.
     * @param verification - What checking the books found.
     * @param exportedAt - When the export was started.
     * @param documents - Whether the documents are in it.
     * @yields The tables, the documents, and the tables of what checking found.
     */
    protected async* resolveFiles(
        fiscalYear: FiscalYear,
        settings: BookkeepingSettings,
        verification: BookkeepingVerification,
        exportedAt: Date,
        documents: boolean
    ): AsyncGenerator<BookkeepingExportFile> {
        const decimals: number = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).getCurrencyMinorUnits(settings.currency);
        const state: ExportState = { accountNumbers: new Map(), entryIds: new Set(), sources: new Map(), documents: [], problems: [] };
        yield this.resolveFiscalYearTable(fiscalYear, settings);
        yield this.resolveAccountTable(state);
        yield this.resolveEntryTable(fiscalYear, state);
        yield this.resolveLineTable(fiscalYear, decimals, state);
        // the sources of the plugins whose entities are declared, so that the tables are the same every year
        if (this.declared.has(Invoice)) {
            yield this.resolveInvoiceTable(decimals, documents, state);
        }
        yield this.resolveExpenseTable(decimals, documents, state);
        if (this.declared.has(BankMatch) && this.declared.has(BankTransaction)) {
            yield this.resolveBankMatchTable(decimals, state);
        }
        if (this.declared.has(BankStatement)) {
            yield this.resolveBankStatementTable(fiscalYear, decimals, documents, state);
        }
        yield this.resolveStatementTable(fiscalYear, documents, state);
        for (const document of state.documents) {
            const content: Readable | undefined = await this.readDocument(document, state);
            if (content != undefined) {
                yield { kind: 'document', path: document.path, content };
            }
        }
        yield this.resolveVerificationTable(verification, exportedAt, state);
        yield this.resolveProblemTable(verification, state);
    }

    /**
     * The table of the fiscal year exported.
     * @param fiscalYear - The fiscal year.
     * @param settings - The settings of the books.
     * @returns The table, of one row.
     */
    protected resolveFiscalYearTable(fiscalYear: FiscalYear, settings: BookkeepingSettings): BookkeepingExportTable {
        return {
            kind: 'table',
            name: FISCAL_YEARS_TABLE,
            description: $ts`The fiscal year exported.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('start', $ts`The first day of the fiscal year.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('end', $ts`The last day of the fiscal year.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('closedAt', $ts`When the fiscal year was closed, in UTC, or empty for an open one.`),
                this.resolveColumn(
                    'reopenings',
                    $ts`How often the fiscal year was reopened after a closing to correct its books.`,
                    BookkeepingExportColumnType.NUMBER
                ),
                this.resolveColumn('currency', $ts`The currency the books are kept in.`)
            ],
            primaryKey: 'id',
            foreignKeys: [],
            rows: this.resolveRowsOf([
                [
                    fiscalYear.id,
                    fiscalYear.start,
                    fiscalYear.end,
                    this.formatMoment(fiscalYear.closedAt),
                    fiscalYear.reopenings,
                    settings.currency
                ]
            ])
        };
    }

    /**
     * The table of the accounts of the books.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveAccountTable(state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'accounts',
            description: $ts`The accounts of the books.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('number', $ts`The number of the account.`),
                this.resolveColumn('name', $ts`The name of the account.`),
                this.resolveColumn('type', $ts`What the account holds: ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE.`),
                this.resolveColumn(
                    'statementPosition',
                    $ts`The position of the balance sheet or the income statement the account is reported in.`
                ),
                this.resolveColumn('creditStatementPosition', $ts`The position the account is reported in while its balance is a credit.`),
                this.resolveColumn('closedAt', $ts`When the account was closed, in UTC, or empty for an open one.`)
            ],
            primaryKey: 'id',
            foreignKeys: [],
            rows: this.resolveAccountRows(state)
        };
    }

    /**
     * Reads the accounts, recording the number of each.
     * @param state - What the export learns.
     * @yields A row per account, by number.
     */
    protected async* resolveAccountRows(state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<BookkeepingAccount> = inject(repositoryTokenFor(BookkeepingAccount));
        for await (const account of repository.stream({ order: { number: 'ASC' } })) {
            state.accountNumbers.set(account.id, account.number);
            yield [
                account.id,
                account.number,
                account.name,
                account.type,
                account.statementPosition ?? null,
                account.creditStatementPosition ?? null,
                this.formatMoment(account.closedAt)
            ];
        }
    }

    /**
     * The table of the entries of the fiscal year.
     * @param fiscalYear - The fiscal year.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveEntryTable(fiscalYear: FiscalYear, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: JOURNAL_ENTRIES_TABLE,
            // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
            description: $ts`The journal entries posted into the fiscal year, each once, by their sequence. An entry is never changed: a wrong one is reversed by another entry.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('fiscalYearId', $ts`The id of the fiscal year.`),
                this.resolveColumn(
                    'sequence',
                    $ts`The number of the entry in its fiscal year, counting from 1 without a gap.`,
                    BookkeepingExportColumnType.NUMBER
                ),
                this.resolveColumn('documentDate', $ts`The day of the document the entry is booked from.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('postingDate', $ts`The day the entry is booked on.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('documentReference', $ts`The number of the document.`),
                this.resolveColumn('text', $ts`What was booked.`),
                this.resolveColumn('createdBy', $ts`The id of the user who posted the entry, or empty when no user did.`),
                this.resolveColumn('reversesEntryId', $ts`The id of the entry this one reverses.`),
                this.resolveColumn(
                    'sourceType',
                    $ts`What kind of thing created the entry, such as invoicing.invoice, or empty for an entry posted by hand.`
                ),
                this.resolveColumn('sourceId', $ts`The id of what created the entry.`),
                this.resolveColumn('postedAt', $ts`When the entry was posted, in UTC.`),
                this.resolveChainSequenceColumn(),
                this.resolveChainHashColumn()
            ],
            primaryKey: 'id',
            foreignKeys: [
                { column: 'fiscalYearId', table: FISCAL_YEARS_TABLE },
                { column: 'reversesEntryId', table: JOURNAL_ENTRIES_TABLE }
            ],
            rows: this.resolveEntryRows(fiscalYear, state)
        };
    }

    /**
     * Reads the entries of the fiscal year, recording each and what posted it.
     * @param fiscalYear - The fiscal year.
     * @param state - What the export learns.
     * @yields A row per entry, by sequence.
     */
    protected async* resolveEntryRows(fiscalYear: FiscalYear, state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<JournalEntry> = inject(repositoryTokenFor(JournalEntry));
        for await (const entry of repository.stream({ where: { fiscalYearId: fiscalYear.id }, order: { sequence: 'ASC' } })) {
            state.entryIds.add(entry.id);
            if (entry.sourceType != undefined && entry.sourceId != undefined) {
                const ids: Set<string> = state.sources.get(entry.sourceType) ?? new Set();
                ids.add(entry.sourceId);
                state.sources.set(entry.sourceType, ids);
            }
            yield [
                entry.id,
                entry.fiscalYearId,
                entry.sequence,
                entry.documentDate,
                entry.postingDate,
                entry.documentReference ?? null,
                entry.text,
                entry.createdBy ?? null,
                entry.reversesEntryId ?? null,
                entry.sourceType ?? null,
                entry.sourceId ?? null,
                this.formatMoment(entry.postedAt),
                entry.chainSequence,
                entry.chainHash
            ];
        }
    }

    /**
     * The table of the lines of the entries written.
     * @param fiscalYear - The fiscal year.
     * @param decimals - The decimals of the currency of the books.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveLineTable(fiscalYear: FiscalYear, decimals: number, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'journal-entry-lines',
            description: $ts`The lines of the journal entries: an amount on the debit or the credit side of an account.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('entryId', $ts`The id of the journal entry.`),
                this.resolveColumn('accountId', $ts`The id of the account.`),
                this.resolveColumn('accountNumber', $ts`The number of the account.`),
                this.resolveColumn(
                    'debit',
                    $ts`The amount on the debit side, in the currency of the books, or empty for a line on the credit side.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveColumn(
                    'credit',
                    $ts`The amount on the credit side, in the currency of the books, or empty for a line on the debit side.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveColumn(
                    'role',
                    // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                    $ts`What the line does beyond its amount: result for the line of the closing carrying the result of the year into equity, or empty.`
                ),
                this.resolveChainSequenceColumn(),
                this.resolveChainHashColumn()
            ],
            primaryKey: 'id',
            foreignKeys: [{ column: 'entryId', table: JOURNAL_ENTRIES_TABLE }, { column: 'accountId', table: 'accounts' }],
            rows: this.resolveLineRows(fiscalYear, state)
        };
    }

    /**
     * Reads the lines of the entries written.
     * @param fiscalYear - The fiscal year.
     * @param state - What the export learns.
     * @yields A row per line, in the order they were posted.
     */
    protected async* resolveLineRows(fiscalYear: FiscalYear, state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<JournalEntryLine> = inject(repositoryTokenFor(JournalEntryLine));
        for await (const line of repository.stream({ where: { fiscalYearId: fiscalYear.id }, order: { chainSequence: 'ASC' } })) {
            // an entry posted after its table was read is left out, and so are its lines: they are posted together
            if (!state.entryIds.has(line.entryId)) {
                continue;
            }
            yield [
                line.id,
                line.entryId,
                line.accountId,
                state.accountNumbers.get(line.accountId) ?? null,
                line.debit ?? null,
                line.credit ?? null,
                line.role ?? null,
                line.chainSequence,
                line.chainHash
            ];
        }
    }

    /**
     * The table of the invoices and credit notes the entries were posted from.
     * @param decimals - The decimals of the currency of the books.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveInvoiceTable(decimals: number, documents: boolean, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'invoices',
            description: $ts`The invoices and credit notes the journal entries were posted from.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('number', $ts`The number of the invoice.`),
                this.resolveColumn('type', $ts`INVOICE or CREDIT_NOTE.`),
                this.resolveColumn('date', $ts`The day of the invoice.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('performanceDate', $ts`The day of the performance.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('dueDate', $ts`The day the invoice is due.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('customer', $ts`The name of the customer.`),
                this.resolveColumn(
                    'precedingInvoices',
                    $ts`The numbers of the invoices this one references, such as the one a credit note corrects.`
                ),
                this.resolveCurrencyColumn(),
                this.resolveColumn('net', $ts`The total before tax.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn('tax', $ts`The total tax.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn('gross', $ts`The total after tax.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn('issuedAt', $ts`When the invoice was issued, in UTC.`),
                this.resolveColumn(
                    'pdf',
                    $ts`The path of the pdf archived at the issue of the invoice in the export, or empty when it is not in it.`
                ),
                this.resolveColumn(
                    'electronicInvoice',
                    // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                    $ts`The path of the xml of the electronic invoice archived at the issue of the invoice in the export, or empty when it is not in it.`
                )
            ],
            primaryKey: 'id',
            foreignKeys: [],
            rows: this.resolveInvoiceRows(documents, state)
        };
    }

    /**
     * Reads the invoices and credit notes the entries were posted from, with their totals, recording the documents
     * archived at their issue.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @yields A row per invoice.
     */
    protected async* resolveInvoiceRows(documents: boolean, state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const calc: InvoiceCalcServiceInterface<Invoice> = inject<InvoiceCalcServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE
        );
        const ids: string[] = [PostingSourceType.INVOICE, PostingSourceType.CREDIT_NOTE]
            .flatMap(type => [...state.sources.get(type) ?? []]);
        for (const chunk of this.resolveChunks(ids)) {
            const invoices: Invoice[] = await repository.findAll({
                where: { id: { oneOf: chunk } },
                order: { number: 'ASC' },
                limit: 'all'
            });
            // the documents of the invoices issued while the invoicing plugin archived them
            const archived: InvoiceDocument[] = documents && this.declared.has(InvoiceDocument)
                ? await inject<Repository<InvoiceDocument>>(repositoryTokenFor(InvoiceDocument)).findAll({
                    where: { invoiceId: { oneOf: chunk } },
                    limit: 'all'
                })
                : [];
            const pdfs: Map<string, string> = await this.resolveDocuments('invoices', archived, d => d.pdf, state);
            const electronic: InvoiceDocument[] = archived.filter(d => d.electronicInvoice != undefined);
            const xmls: Map<string, string> = await this.resolveDocuments('invoices', electronic, d => d.electronicInvoice ?? '', state);
            const documentOf: Map<string, InvoiceDocument> = new Map(archived.map(d => [d.invoiceId, d]));
            for (const invoice of invoices) {
                const document: InvoiceDocument | undefined = documentOf.get(invoice.id);
                const address: Invoice['customerAddressData'] = invoice.customerAddressData;
                yield [
                    invoice.id,
                    invoice.number,
                    invoice.type ?? null,
                    this.resolveDay(invoice.date),
                    this.resolveDay(invoice.performanceDate),
                    this.resolveDay(invoice.dueDate),
                    address.company ? address.companyName ?? null : `${address.firstName} ${address.lastName}`.trim(),
                    (invoice.precedingInvoices ?? []).map(i => i.number).join(', ') || null,
                    invoice.currency,
                    await calc.getTotalBeforeTax(invoice),
                    await calc.getTotalTax(invoice),
                    await calc.getTotalAfterTax(invoice),
                    this.formatMoment(invoice.issuedAt),
                    document == undefined ? null : pdfs.get(document.id) ?? null,
                    document == undefined ? null : xmls.get(document.id) ?? null
                ];
            }
        }
    }

    /**
     * The table of the expenses the entries were posted from.
     * @param decimals - The decimals of the currency of the books.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveExpenseTable(decimals: number, documents: boolean, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'expenses',
            description: $ts`The expenses, invoices received and receipts, the journal entries were posted from.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('documentNumber', $ts`The number of the document.`),
                this.resolveColumn('documentDate', $ts`The day of the document.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('dueDate', $ts`The day it is due.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('supplier', $ts`Who issued the document.`),
                this.resolveColumn('supplierVatId', $ts`The VAT id of who issued the document.`),
                this.resolveCurrencyColumn(),
                this.resolveColumn('net', $ts`The total before tax.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn('tax', $ts`The total tax.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn('accountId', $ts`The id of the account the amounts before tax are posted on.`),
                this.resolveColumn('recordedAt', $ts`When the expense was recorded, in UTC.`),
                this.resolveColumn('postedEntryId', $ts`The id of the journal entry recording it posted.`),
                this.resolveColumn('correctsExpenseId', $ts`The id of the expense this one corrects.`),
                this.resolveColumn('receiptId', $ts`The id of the receipt kept with it.`),
                this.resolveColumn('receipt', $ts`The path of the receipt in the export, or empty when it is not in it.`)
            ],
            primaryKey: 'id',
            foreignKeys: [
                { column: 'accountId', table: 'accounts' },
                { column: 'postedEntryId', table: JOURNAL_ENTRIES_TABLE },
                { column: 'correctsExpenseId', table: 'expenses' }
            ],
            rows: this.resolveExpenseRows(documents, state)
        };
    }

    /**
     * Reads the expenses the entries were posted from, recording the documents of their receipts.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @yields A row per expense.
     */
    protected async* resolveExpenseRows(documents: boolean, state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<Expense> = inject(repositoryTokenFor(Expense));
        const receiptRepository: Repository<ExpenseReceipt> = inject(repositoryTokenFor(ExpenseReceipt));
        for (const chunk of this.resolveChunks([...state.sources.get(PostingSourceType.EXPENSE) ?? []])) {
            const expenses: Expense[] = await repository.findAll({
                where: { id: { oneOf: chunk } },
                order: { documentDate: 'ASC' },
                limit: 'all'
            });
            const receiptIds: string[] = expenses.flatMap(e => e.receiptId == undefined ? [] : [e.receiptId]);
            const receipts: ExpenseReceipt[] = documents && receiptIds.length
                ? await receiptRepository.findAll({ where: { id: { oneOf: receiptIds } }, limit: 'all' })
                : [];
            const paths: Map<string, string> = await this.resolveDocuments('expense-receipts', receipts, r => r.file, state);
            for (const expense of expenses) {
                yield [
                    expense.id,
                    expense.documentNumber,
                    expense.documentDate,
                    expense.dueDate ?? null,
                    expense.supplier.name,
                    expense.supplier.vatId ?? null,
                    expense.currency,
                    expense.totals.reduce((sum, t) => NumberUtilities.add(sum, t.net), new BigNumber(0)),
                    expense.totals.reduce((sum, t) => NumberUtilities.add(sum, t.tax), new BigNumber(0)),
                    expense.accountId,
                    this.formatMoment(expense.recordedAt),
                    expense.postedEntryId ?? null,
                    expense.correctsExpenseId ?? null,
                    expense.receiptId ?? null,
                    expense.receiptId == undefined ? null : paths.get(expense.receiptId) ?? null
                ];
            }
        }
    }

    /**
     * The table of the bank matches the entries were posted from, with their transactions.
     * @param decimals - The decimals of the currency of the books.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveBankMatchTable(decimals: number, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'bank-matches',
            description: $ts`The matches of bank transactions the journal entries were posted from, with their transactions.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('transactionId', $ts`The id of the bank transaction.`),
                this.resolveColumn('statementId', $ts`The id of the bank statement of the transaction.`),
                this.resolveColumn('bookingDate', $ts`The day the transaction was booked.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn(
                    'transactionAmount',
                    $ts`The amount of the transaction, negative for money paid.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveColumn('counterpartyName', $ts`The name of the counterparty.`),
                this.resolveColumn('counterpartyIban', $ts`The IBAN of the counterparty.`),
                this.resolveColumn('remittanceInformation', $ts`The remittance information.`),
                this.resolveColumn('targetType', $ts`What the transaction is matched with.`),
                this.resolveColumn('targetId', $ts`The id of what the transaction is matched with.`),
                this.resolveColumn('amount', $ts`The amount matched.`, BookkeepingExportColumnType.NUMBER, decimals),
                this.resolveColumn(
                    'difference',
                    $ts`What the amount matched differs from the amount open by, booked as a payment difference.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveCurrencyColumn(),
                this.resolveColumn('reversesMatchId', $ts`The id of the match this one reverses.`),
                this.resolveColumn('confirmedBy', $ts`Who confirmed the match.`),
                this.resolveColumn('confirmedAt', $ts`When the match was confirmed, in UTC.`)
            ],
            primaryKey: 'id',
            foreignKeys: [{ column: 'reversesMatchId', table: 'bank-matches' }],
            rows: this.resolveBankMatchRows(state)
        };
    }

    /**
     * Reads the bank matches the entries were posted from, with their transactions.
     * @param state - What the export learns.
     * @yields A row per match.
     */
    protected async* resolveBankMatchRows(state: ExportState): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<BankMatch> = inject(repositoryTokenFor(BankMatch));
        const transactionRepository: Repository<BankTransaction> = inject(repositoryTokenFor(BankTransaction));
        for (const chunk of this.resolveChunks([...state.sources.get(PostingSourceType.BANK_MATCH) ?? []])) {
            const matches: BankMatch[] = await repository.findAll({
                where: { id: { oneOf: chunk } },
                order: { confirmedAt: 'ASC' },
                limit: 'all'
            });
            const transactions: Map<string, BankTransaction> = new Map((await transactionRepository.findAll({
                where: { id: { oneOf: [...new Set(matches.map(m => m.transactionId))] } },
                limit: 'all'
            })).map(t => [t.id, t]));
            for (const match of matches) {
                const transaction: BankTransaction | undefined = transactions.get(match.transactionId);
                yield [
                    match.id,
                    match.transactionId,
                    transaction?.statementId ?? null,
                    transaction == undefined ? null : this.resolveDay(transaction.bookingDate),
                    transaction?.amount ?? null,
                    transaction?.counterpartyName ?? null,
                    transaction?.counterpartyIban ?? null,
                    transaction?.remittanceInformation ?? null,
                    match.targetType,
                    match.targetId,
                    match.amount,
                    match.difference ?? null,
                    match.currency,
                    match.reversesMatchId ?? null,
                    match.confirmedBy,
                    this.formatMoment(match.confirmedAt)
                ];
            }
        }
    }

    /**
     * The table of the bank statements covering a day of the fiscal year.
     * @param fiscalYear - The fiscal year.
     * @param decimals - The decimals of the currency of the books.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveBankStatementTable(
        fiscalYear: FiscalYear,
        decimals: number,
        documents: boolean,
        state: ExportState
    ): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'bank-statements',
            description: $ts`The bank statements covering a day of the fiscal year.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('accountId', $ts`The id of the bank account.`),
                this.resolveColumn('bankStatementId', $ts`The id the bank gave the statement.`),
                this.resolveColumn('issuedAt', $ts`When the bank created the statement, in UTC.`),
                this.resolveColumn('periodStart', $ts`The first day the statement covers.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn('periodEnd', $ts`The last day the statement covers.`, BookkeepingExportColumnType.DAY),
                this.resolveColumn(
                    'openingBalance',
                    $ts`The booked balance at the start of the period, negative below zero.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveColumn(
                    'closingBalance',
                    $ts`The booked balance at the end of the period, negative below zero.`,
                    BookkeepingExportColumnType.NUMBER,
                    decimals
                ),
                this.resolveCurrencyColumn(),
                this.resolveColumn(
                    'file',
                    $ts`The path of the original file of the statement in the export, or empty when it is not in it.`
                )
            ],
            primaryKey: 'id',
            foreignKeys: [],
            rows: this.resolveBankStatementRows(fiscalYear, documents, state)
        };
    }

    /**
     * Reads the bank statements covering a day of the fiscal year, recording their files.
     * @param fiscalYear - The fiscal year.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @yields A row per statement, by the start of its period.
     */
    protected async* resolveBankStatementRows(
        fiscalYear: FiscalYear,
        documents: boolean,
        state: ExportState
    ): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<BankStatement> = inject(repositoryTokenFor(BankStatement));
        // a day around the fiscal year, whose moments may fall on the day before or after it in UTC: which day a
        // moment is in decides the zone the books are posted in, below
        const statements: BankStatement[] = await repository.findAll({
            where: {
                periodStart: { before: BookkeepingDayUtilities.resolveNextDay(BookkeepingDayUtilities.resolveNextDay(fiscalYear.end)) },
                periodEnd: { afterOrOn: BookkeepingDayUtilities.resolvePreviousDay(fiscalYear.start) }
            },
            order: { periodStart: 'ASC' },
            limit: 'all'
        });
        const inYear: BankStatement[] = statements.filter(s => this.resolveDay(s.periodStart) <= fiscalYear.end
            && this.resolveDay(s.periodEnd) >= fiscalYear.start);
        const paths: Map<string, string> = documents
            ? await this.resolveDocuments('bank-statements', inYear, s => s.file, state)
            : new Map<string, string>();
        for (const statement of inYear) {
            yield [
                statement.id,
                statement.accountId,
                statement.bankStatementId,
                this.formatMoment(statement.issuedAt),
                this.resolveDay(statement.periodStart),
                this.resolveDay(statement.periodEnd),
                statement.openingBalance,
                statement.closingBalance,
                statement.currency,
                paths.get(statement.id) ?? null
            ];
        }
    }

    /**
     * The table of the statements archived at the closing of the fiscal year.
     * @param fiscalYear - The fiscal year.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveStatementTable(fiscalYear: FiscalYear, documents: boolean, state: ExportState): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'fiscal-year-statements',
            description: $ts`The balance sheets and income statements archived at the closing of the fiscal year, none for an open one.`,
            columns: [
                this.resolveIdColumn(),
                this.resolveColumn('fiscalYearId', $ts`The id of the fiscal year.`),
                this.resolveColumn(
                    'closing',
                    // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                    $ts`The closing of the fiscal year the statement was archived at, 1 for the first. Those of the closing after the last reopening count.`,
                    BookkeepingExportColumnType.NUMBER
                ),
                this.resolveColumn('type', $ts`BALANCE_SHEET or INCOME_STATEMENT.`),
                this.resolveColumn('form', $ts`The form of the statement, such as hgb.balance-sheet.micro.`),
                this.resolveColumn('applies', $ts`Whether the statement is in the form that applied to the fiscal year: true or false.`),
                this.resolveColumn('archivedAt', $ts`When the statement was archived, in UTC.`),
                this.resolveColumn('file', $ts`The path of the pdf of the statement in the export, or empty when it is not in it.`)
            ],
            primaryKey: 'id',
            foreignKeys: [{ column: 'fiscalYearId', table: FISCAL_YEARS_TABLE }],
            rows: this.resolveStatementRows(fiscalYear, documents, state)
        };
    }

    /**
     * Reads the statements archived at the closing of the fiscal year, recording their pdfs.
     * @param fiscalYear - The fiscal year.
     * @param documents - Whether the documents are in the export.
     * @param state - What the export learns.
     * @yields A row per statement, by form.
     */
    protected async* resolveStatementRows(
        fiscalYear: FiscalYear,
        documents: boolean,
        state: ExportState
    ): AsyncGenerator<BookkeepingExportValue[]> {
        const repository: Repository<FiscalYearStatement> = inject(repositoryTokenFor(FiscalYearStatement));
        // those of an earlier closing as well, which a reopening kept
        const statements: FiscalYearStatement[] = await repository.findAll({
            where: { fiscalYearId: fiscalYear.id },
            order: { closing: 'ASC', form: 'ASC' },
            limit: 'all'
        });
        const paths: Map<string, string> = documents
            ? await this.resolveDocuments('fiscal-year-statements', statements, s => s.file, state)
            : new Map<string, string>();
        for (const statement of statements) {
            yield [
                statement.id,
                statement.fiscalYearId,
                statement.closing,
                statement.type,
                statement.form,
                String(statement.applies),
                this.formatMoment(statement.archivedAt),
                paths.get(statement.id) ?? null
            ];
        }
    }

    /**
     * The table of what checking the books found, and how many documents could not be read.
     * @param verification - What checking the books found.
     * @param exportedAt - When the export was started, and the books were checked.
     * @param state - What the export learns.
     * @returns The table, of one row.
     */
    protected resolveVerificationTable(
        verification: BookkeepingVerification,
        exportedAt: Date,
        state: ExportState
    ): BookkeepingExportTable {
        return {
            kind: 'table',
            name: 'verification',
            description: verification.intact
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                ? $ts`What checking the books found: the chains of the journal entries and of their lines hold, and every entry balances. Checking covers every fiscal year of the books, as a chain holds only as a whole.`
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                : $ts`What checking the books found: the chains of the journal entries and of their lines, or the balance of an entry, do not hold, see verification-problems. Checking covers every fiscal year of the books, as a chain holds only as a whole.`,
            columns: [
                this.resolveColumn('checkedAt', $ts`When the books were checked, in UTC.`),
                this.resolveColumn(
                    'intact',
                    $ts`Whether the chains of the journal entries and of their lines hold, and every entry balances: true or false.`
                ),
                this.resolveColumn(
                    'newestEntrySequence',
                    $ts`The place of the newest entry in its chain, or empty for a chain that is broken.`,
                    BookkeepingExportColumnType.NUMBER
                ),
                this.resolveColumn('newestEntryHash', $ts`The hash of the newest entry, or empty for a chain that is broken.`),
                this.resolveColumn(
                    'newestLineSequence',
                    $ts`The place of the newest line in its chain, or empty for a chain that is broken.`,
                    BookkeepingExportColumnType.NUMBER
                ),
                this.resolveColumn('newestLineHash', $ts`The hash of the newest line, or empty for a chain that is broken.`),
                this.resolveColumn('problems', $ts`How many problems checking the books found.`, BookkeepingExportColumnType.NUMBER),
                this.resolveColumn(
                    'unreadableDocuments',
                    $ts`How many documents could not be read unchanged, and are not in the export.`,
                    BookkeepingExportColumnType.NUMBER
                )
            ],
            primaryKey: undefined,
            foreignKeys: [],
            rows: this.resolveVerificationRows(verification, exportedAt, state)
        };
    }

    /**
     * Reads what checking the books found, once the documents are read.
     * @param verification - What checking the books found.
     * @param exportedAt - When the export was started.
     * @param state - What the export learns.
     * @yields The one row.
     */
    protected async* resolveVerificationRows(
        verification: BookkeepingVerification,
        exportedAt: Date,
        state: ExportState
    ): AsyncGenerator<BookkeepingExportValue[]> {
        yield* this.resolveRowsOf([
            [
                exportedAt.toISOString(),
                String(verification.intact),
                verification.newestEntrySequence,
                verification.newestEntryHash,
                verification.newestLineSequence,
                verification.newestLineHash,
                verification.problems.length,
                state.problems.length
            ]
        ]);
    }

    /**
     * The table of each problem checking the books found, and each document that could not be read.
     * @param verification - What checking the books found.
     * @param state - What the export learns.
     * @returns The table.
     */
    protected resolveProblemTable(verification: BookkeepingVerification, state: ExportState): BookkeepingExportTable {
        const problems: ExportProblem[] = [...verification.problems.map(p => ({ ...p, document: null })), ...state.problems];
        return {
            kind: 'table',
            name: 'verification-problems',
            // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
            description: $ts`Each problem checking the books found, naming its entry or line, and each document that could not be read unchanged. None for intact books.`,
            columns: [
                this.resolveColumn('entryId', $ts`The id of the journal entry the problem is of.`),
                this.resolveColumn('lineId', $ts`The id of the line the problem is of.`),
                this.resolveColumn('document', $ts`The path the document that could not be read would have in the export.`),
                this.resolveColumn('reason', $ts`What is wrong.`)
            ],
            primaryKey: undefined,
            foreignKeys: [],
            rows: this.resolveRowsOf(problems.map(p => [p.entryId, p.lineId, p.document, p.reason]))
        };
    }

    /**
     * Records the documents of archived rows, to be read once every table is written, and resolves their paths.
     * @param folder - The folder of the documents in the export, such as `expense-receipts`.
     * @param rows - The rows.
     * @param fileOf - The id of the file of a row.
     * @param state - What the export learns.
     * @returns The path of the document of each row, by the id of the row.
     */
    protected async resolveDocuments<T extends BaseArchivedEntity>(
        folder: string,
        rows: T[],
        fileOf: (row: T) => string,
        state: ExportState
    ): Promise<Map<string, string>> {
        const files: Map<string, FileRecord> = new Map(rows.length
            ? (await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFiles(rows.map(fileOf))).map(f => [f.id, f])
            : []);
        const res: Map<string, string> = new Map();
        for (const row of rows) {
            const fileId: string = fileOf(row);
            // the id of the row first, so that two documents of the same name do not meet
            const path: string = `documents/${folder}/${row.id}-${this.resolveFileName(files.get(fileId)?.name ?? fileId)}`;
            state.documents.push({ row, fileId, path });
            res.set(row.id, path);
        }
        return res;
    }

    /**
     * Reads a document from the archive, from the first of its copies that holds.
     * @param document - The document.
     * @param state - What the export learns, which records a document that cannot be read.
     * @returns Its bytes, or undefined when no copy of it holds.
     */
    protected async readDocument(document: ExportedDocument, state: ExportState): Promise<Readable | undefined> {
        try {
            return await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(document.row, document.fileId);
        }
        catch (error) {
            // stated in the export rather than failing it: an export that stops at a changed document hands an
            // auditor nothing of the rest
            const message: string = error instanceof Error ? error.message : String(error);
            state.problems.push({
                entryId: null,
                lineId: null,
                document: document.path,
                reason: $ts`The document could not be read unchanged: ${message}`
            });
            return undefined;
        }
    }

    /**
     * Makes an archive read in the async context it was exported in, such as the tenant a route ran it as, whatever
     * reads it later.
     * @param content - The archive.
     * @returns The same bytes, each read in that context.
     */
    protected bindToContext(content: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
        // a generator runs in the context of whoever pulls it, which for a response is the server sending it,
        // outside the tenant the route ran as
        const runInContext: <R>(fn: () => R) => R = AsyncLocalStorage.snapshot();
        return {
            [Symbol.asyncIterator]: (): AsyncIterator<Buffer> => {
                const iterator: AsyncIterator<Buffer> = runInContext(() => content[Symbol.asyncIterator]());
                return {
                    next: async () => await runInContext(async () => await iterator.next()),
                    return: async () => await runInContext(async () => await iterator.return?.() ?? { done: true, value: undefined })
                };
            }
        };
    }

    /**
     * The day of a moment of an invoice or a bank transaction, in the `defaultTimezone` the books post it on.
     * @param moment - The moment.
     * @returns The day, at midnight UTC.
     */
    protected resolveDay(moment: Date): Date {
        return BookkeepingDayUtilities.resolveDay(moment, inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone);
    }

    /**
     * A moment as the export writes it: its ISO 8601 form in UTC.
     * @param moment - The moment.
     * @returns The text, or null for none.
     */
    protected formatMoment(moment: Date | null | undefined): string | null {
        return moment == undefined ? null : moment.toISOString();
    }

    /**
     * The name of a document as its path in the export holds it: letters, digits, dots, hyphens and underscores, the
     * rest as underscores, the last 100 characters of it.
     * @param name - The name it was stored under.
     * @returns The name.
     */
    protected resolveFileName(name: string): string {
        const safe: string = name.replaceAll(/[^\w.-]/g, '_');
        return safe.length > MAX_DOCUMENT_NAME_LENGTH ? safe.slice(safe.length - MAX_DOCUMENT_NAME_LENGTH) : safe;
    }

    private resolveColumn(
        name: string,
        description: string,
        type: BookkeepingExportColumnType = BookkeepingExportColumnType.TEXT,
        decimals?: number
    ): BookkeepingExportColumn {
        return { name, description, type, decimals };
    }

    private resolveIdColumn(): BookkeepingExportColumn {
        return this.resolveColumn('id', $ts`The id of the row.`);
    }

    private resolveCurrencyColumn(): BookkeepingExportColumn {
        return this.resolveColumn('currency', $ts`The currency of the amounts, such as EUR.`);
    }

    private resolveChainSequenceColumn(): BookkeepingExportColumn {
        return this.resolveColumn(
            'chainSequence',
            $ts`The place of the row in the hash chain of its table.`,
            BookkeepingExportColumnType.NUMBER
        );
    }

    private resolveChainHashColumn(): BookkeepingExportColumn {
        return this.resolveColumn(
            'chainHash',
            $ts`The hash of the row in the hash chain of its table, over the row and the hash before it.`
        );
    }

    private resolveChunks(ids: string[]): string[][] {
        const res: string[][] = [];
        for (let start: number = 0; start < ids.length; start += CHUNK_SIZE) {
            res.push(ids.slice(start, start + CHUNK_SIZE));
        }
        return res;
    }

    private async* resolveRowsOf(rows: BookkeepingExportValue[][]): AsyncGenerator<BookkeepingExportValue[]> {
        for (const row of rows) {
            yield await Promise.resolve(row);
        }
    }
}