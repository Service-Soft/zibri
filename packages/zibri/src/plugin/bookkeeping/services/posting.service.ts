import type { ZibriApplication } from '../../../application/application';
import { KeptRowDivergenceReason } from '../../../backup/kept-row-divergence-reason.enum';
import { type KeptRowDivergence } from '../../../backup/kept-row-divergence.model';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { TransactionUtilities } from '../../../data-source/transaction/transaction.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { $ts } from '../../../localization/translate.function';
import { Newable } from '../../../types/newable.type';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BankMatchTargetType } from '../../bank/models/bank-match-target-type.enum';
import { BankMatch } from '../../bank/models/bank-match.model';
import { type BankTransaction } from '../../bank/models/bank-transaction.model';
import { type BankMatchPostingInterface } from '../../bank/services/bank-match-posting.interface';
import { InvoiceType } from '../../invoicing/models/invoice-type.enum';
import { Invoice } from '../../invoicing/models/invoice.model';
import { type InvoicePostingInterface } from '../../invoicing/services/invoice-posting.interface';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { type BookkeepingPluginOptions } from '../models/bookkeeping-plugin-options.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { ExpenseReceipt } from '../models/expense-receipt.model';
import { Expense } from '../models/expense.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { JournalEntryLine } from '../models/journal-entry-line.model';
import { JournalEntry } from '../models/journal-entry.model';
import { type NewJournalEntryLine } from '../models/new-journal-entry-line.model';
import { type NewJournalEntry } from '../models/new-journal-entry.model';
import { PostingSourceType } from '../models/posting-source-type.enum';
import { type PostingSource } from '../models/posting-source.model';
import { type JournalServiceInterface } from './journal-service.interface';
import { type PostingServiceInterface } from './posting-service.interface';

/**
 * How many ids one read looks for, so that the sources of many entries are read in pages.
 */
const IDS_PER_READ: number = 500;

/**
 * What a divergence says of a source that no longer exists.
 */
const SOURCE_GONE: string = 'which is gone';

/**
 * What the check of the kept entries reads of their sources once, for every entry.
 */
type KeptEntrySources = {
    /**
     * The invoices and credit notes, by their ids.
     */
    invoices: Map<string, Invoice>,
    /**
     * The expenses, by their ids.
     */
    expenses: Map<string, Expense>,
    /**
     * The ids of the bank matches.
     */
    matches: Set<string>,
    /**
     * The debits of the entry checked.
     */
    debit: BigNumber,
    /**
     * The settings of the books.
     */
    settings: BookkeepingSettings
};

/**
 * Default implementation of the posting service. It is also the posting of issued invoices the invoicing plugin hands
 * them to, and the posting of bank matches the bank plugin hands them to.
 */
@Injectable({ register: 'onUse' })
export class PostingService implements PostingServiceInterface, InvoicePostingInterface, BankMatchPostingInterface, OnAppInit {
    /**
     * The entities the data sources of the application declare, which tells the sources there are.
     */
    private declared: Set<Newable<BaseEntity>> = new Set();

    // read when used, like the repositories of the journal service: ZibriBookkeepingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get entryRepository(): Repository<JournalEntry> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    private get lineRepository(): Repository<JournalEntryLine> {
        return inject(repositoryTokenFor(JournalEntryLine));
    }

    private get expenseRepository(): Repository<Expense> {
        return inject(repositoryTokenFor(Expense));
    }

    private get journalService(): JournalServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BookkeepingPluginOptions
    ) {}

    /**
     * Reads the entities the application declares.
     * @param app - The application that starts.
     */
    onAppInit(app: ZibriApplication): void {
        this.declared = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async postFor(source: PostingSource, transaction?: Transaction): Promise<JournalEntryDetails | undefined> {
        const work: (started: Transaction) => Promise<JournalEntryDetails | undefined> = async started => {
            const settings: BookkeepingSettings | undefined = await this.findSettings(started);
            if (settings == undefined) {
                return undefined;
            }
            const entry: NewJournalEntry | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE)
                .resolveEntry(source, settings, started);
            if (entry == undefined) {
                return undefined;
            }
            const sourceId: string = this.resolveSourceId(source);
            // posted before, such as an invoice a restore of the tenant brought back as a draft and that is issued again,
            // beside the entry the restore kept
            const posted: JournalEntry | undefined = await this.findEntryOf(source.type, sourceId, started);
            return posted != undefined
                ? await this.resolvePostedAgain(posted, entry, started)
                : await this.journalService.post({ ...entry, sourceType: source.type, sourceId }, started);
        };
        return transaction == undefined
            ? await this.entryRepository.dataSource.runInTransaction(work, { maxAttempts: 3 })
            : await work(transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveKeptRowDivergences(): Promise<KeptRowDivergence[]> {
        // read as of one moment, the entries beside the rows they were posted from
        return await this.entryRepository.dataSource.runInTransaction(async started => [
            ...await this.resolveEntryDivergences(started),
            ...await this.resolveReceiptDivergences(started),
            ...await this.resolveExpenseMatchDivergences(started)
        ], { maxAttempts: 1 });
    }

    /**
     * Resolves the entry a source posted already, when it is posted again: the entry as it stands when it posts what
     * the source posts now, which posts nothing more.
     * @param posted - The entry posted of the source before.
     * @param entry - What the source posts now.
     * @param transaction - The transaction.
     * @returns The entry posted before, with its lines.
     * @throws A ConflictError for an entry that is reversed, or that posts other amounts or another day, which a source
     * posts once: its corrected entry is posted by hand.
     */
    protected async resolvePostedAgain(
        posted: JournalEntry,
        entry: NewJournalEntry,
        transaction: Transaction
    ): Promise<JournalEntryDetails> {
        const sourceType: string = posted.sourceType ?? '';
        const sourceId: string = posted.sourceId ?? '';
        if ((await this.journalService.resolveReversingEntryIds([posted.id], transaction)).has(posted.id)) {
            throw new ConflictError([
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                $ts`The source ${sourceType} "${sourceId}" was posted by the entry ${posted.sequence}, which is reversed, and a source is posted once.`,
                $ts`Post its corrected entry with POST /entries.`
            ]);
        }
        const lines: JournalEntryLine[] = await this.lineRepository.findAll({
            where: { entryId: posted.id },
            order: { chainSequence: 'ASC' },
            limit: 'all',
            transaction
        });
        if (posted.postingDate.getTime() !== entry.postingDate.getTime()
            || NumberUtilities.compare(this.resolveDebitTotal(lines), this.resolveDebitTotal(entry.lines)) !== 0) {
            throw new ConflictError([
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                $ts`The source ${sourceType} "${sourceId}" was posted by the entry ${posted.sequence}, which posts other amounts or another day than it does now.`,
                $ts`Reverse that entry, and post its corrected entry with POST /entries.`
            ]);
        }
        return { entry: posted, lines, reversedByEntryId: null };
    }

    /**
     * Resolves the entries that stand and no longer match the invoice, credit note, expense or bank match they were
     * posted from: one that is gone, a draft again, or that posts other amounts or another day now.
     * @param transaction - The transaction to read in.
     * @returns The entries.
     */
    protected async resolveEntryDivergences(transaction: Transaction): Promise<KeptRowDivergence[]> {
        const settings: BookkeepingSettings | undefined = await this.journalService.findSettings(transaction);
        if (settings == undefined) {
            return [];
        }
        const entries: Pick<JournalEntry, 'id' | 'sequence' | 'sourceType' | 'sourceId' | 'postingDate' | 'fiscalYearId'>[] = [];
        for await (const row of this.entryRepository.stream({
            // a reversal undoes the entry it reverses, which reversing an entry resolves
            where: { sourceType: { oneOf: Object.values(PostingSourceType) }, reversesEntryId: null },
            select: { id: true, sequence: true, sourceType: true, sourceId: true, postingDate: true, fiscalYearId: true },
            transaction
        })) {
            entries.push(row);
        }
        const reversed: Map<string, string> = await this.journalService.resolveReversingEntryIds(entries.map(e => e.id), transaction);
        const standing: typeof entries = entries.filter(e => !reversed.has(e.id) && e.sourceId != undefined);
        if (!standing.length) {
            return [];
        }
        const sourceIds: (types: PostingSourceType[]) => string[] = types => {
            const ids: string[] = standing.flatMap(e => types.some(t => t === e.sourceType) ? [e.sourceId ?? ''] : []);
            return [...new Set(ids)];
        };
        const invoices: Map<string, Invoice> = this.declared.has(Invoice)
            ? new Map<string, Invoice>((await this.findInPages(
                sourceIds([PostingSourceType.INVOICE, PostingSourceType.CREDIT_NOTE]),
                async page => await inject<Repository<Invoice>>(
                    repositoryTokenFor(Invoice)
                ).findAll({ where: { id: { oneOf: page } }, limit: 'all', transaction })
            )).map(i => [i.id, i]))
            : new Map<string, Invoice>();
        const expenses: Map<string, Expense> = new Map((await this.findInPages(
            sourceIds([PostingSourceType.EXPENSE]),
            async page => await this.expenseRepository.findAll({ where: { id: { oneOf: page } }, limit: 'all', transaction })
        )).map(e => [e.id, e]));
        const matches: Set<string> = this.declared.has(BankMatch)
            ? new Set((await this.findInPages(sourceIds([PostingSourceType.BANK_MATCH]), async page => await inject<Repository<BankMatch>>(
                repositoryTokenFor(BankMatch)
            ).findAll({ where: { id: { oneOf: page } }, select: { id: true }, limit: 'all', transaction }))).map(m => m.id))
            : new Set();
        const debits: Map<string, BigNumber> = await this.resolveEntryDebits(standing, transaction);
        const res: KeptRowDivergence[] = [];
        // one after the other, as each resolves the entry its source posts now in the transaction
        for (const entry of standing) {
            const divergence: KeptRowDivergence | undefined = await this.resolveEntryDivergence(
                entry,
                { invoices, expenses, matches, debit: debits.get(entry.id) ?? new BigNumber(0), settings },
                transaction
            );
            if (divergence != undefined) {
                res.push(divergence);
            }
        }
        return res;
    }

    /**
     * Resolves whether an entry no longer matches its source.
     * @param entry - The entry.
     * @param read - The sources read, the debits of the entry and the settings of the books.
     * @param transaction - The transaction.
     * @returns The divergence, or undefined for an entry that matches.
     */
    protected async resolveEntryDivergence(
        entry: Pick<JournalEntry, 'id' | 'sequence' | 'sourceType' | 'sourceId' | 'postingDate'>,
        read: KeptEntrySources,
        transaction: Transaction
    ): Promise<KeptRowDivergence | undefined> {
        const sourceId: string = entry.sourceId ?? '';
        const of: (reason: KeptRowDivergenceReason, sourceEntity: string, message: string) => KeptRowDivergence = (
            reason,
            sourceEntity,
            message
        ) => this.resolveDivergenceOf(entry, sourceId, { reason, sourceEntity, message });
        let source: PostingSource;
        switch (entry.sourceType) {
            case PostingSourceType.INVOICE:
            case PostingSourceType.CREDIT_NOTE: {
                const invoice: Invoice | undefined = read.invoices.get(sourceId);
                if (invoice?.issuedAt == undefined) {
                    return invoice == undefined
                        ? of(KeptRowDivergenceReason.SOURCE_MISSING, Invoice.name, SOURCE_GONE)
                        : of(KeptRowDivergenceReason.SOURCE_DRAFT, Invoice.name, `the invoice ${invoice.number}, which is a draft again`);
                }
                source = { type: entry.sourceType, invoice };
                break;
            }
            case PostingSourceType.EXPENSE: {
                const expense: Expense | undefined = read.expenses.get(sourceId);
                if (expense?.recordedAt == undefined) {
                    return expense == undefined
                        ? of(KeptRowDivergenceReason.SOURCE_MISSING, Expense.name, SOURCE_GONE)
                        : of(
                            KeptRowDivergenceReason.SOURCE_DRAFT,
                            Expense.name,
                            `the expense ${expense.documentNumber}, which is a draft again`
                        );
                }
                source = { type: PostingSourceType.EXPENSE, expense };
                break;
            }
            case PostingSourceType.BANK_MATCH: {
                // a match is kept as it is confirmed, like its entry, and its target is checked with the matches
                return read.matches.has(sourceId) || !this.declared.has(BankMatch)
                    ? undefined
                    : of(KeptRowDivergenceReason.SOURCE_MISSING, BankMatch.name, SOURCE_GONE);
            }
            case null:
            case undefined: {
                // an entry posted by hand has no source to compare with
                return undefined;
            }
            default: {
                // a source this check does not know
                return undefined;
            }
        }
        return await this.resolvePostsOtherwise(entry, source, read, transaction)
            ? of(
                KeptRowDivergenceReason.SOURCE_CHANGED,
                this.resolveSourceEntityName(source),
                'which posts other amounts or another day now'
            )
            : undefined;
    }

    /**
     * Resolves the divergence of an entry from its source.
     * @param entry - The entry.
     * @param sourceId - The id of its source.
     * @param divergence - Why it diverges, the entity of the source and what is wrong with it.
     * @returns The divergence.
     */
    private resolveDivergenceOf(
        entry: Pick<JournalEntry, 'id' | 'sequence' | 'sourceType'>,
        sourceId: string,
        divergence: Pick<KeptRowDivergence, 'reason' | 'sourceEntity' | 'message'>
    ): KeptRowDivergence {
        return {
            entity: JournalEntry.name,
            id: entry.id,
            sourceEntity: divergence.sourceEntity,
            sourceId,
            reason: divergence.reason,
            message: `The entry ${entry.sequence} posted ${entry.sourceType ?? ''} ${sourceId}, ${divergence.message}.`
        };
    }

    /**
     * Resolves the name of the entity a source is stored as.
     * @param source - The source.
     * @returns The name of its entity.
     */
    private resolveSourceEntityName(source: PostingSource): string {
        return source.type === PostingSourceType.EXPENSE ? Expense.name : Invoice.name;
    }

    /**
     * Resolves whether a source posts other amounts or another day now than its entry does.
     * @param entry - The entry posted of the source.
     * @param source - The source.
     * @param read - The sources read, the debits of the entry and the settings of the books.
     * @param transaction - The transaction.
     * @returns Whether it does, and false when what the source posts now cannot be told.
     */
    private async resolvePostsOtherwise(
        entry: Pick<JournalEntry, 'postingDate'>,
        source: PostingSource,
        read: KeptEntrySources,
        transaction: Transaction
    ): Promise<boolean> {
        let now: NewJournalEntry | undefined;
        try {
            now = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).resolveEntry(source, read.settings, transaction);
        }
        catch {
            // what the source posts now cannot be told, such as on a day without posting rules: not compared
            return false;
        }
        return now == undefined
            ? true
            : now.postingDate.getTime() !== entry.postingDate.getTime()
                || NumberUtilities.compare(this.resolveDebitTotal(now.lines), read.debit) !== 0;
    }

    /**
     * Resolves the receipts of expenses that no expense names, such as one whose expense a restore of the tenant took
     * away and kept the receipt, which is archived.
     * @param transaction - The transaction to read in.
     * @returns The receipts.
     */
    protected async resolveReceiptDivergences(transaction: Transaction): Promise<KeptRowDivergence[]> {
        const named: Set<string> = new Set();
        for await (const row of this.expenseRepository.stream({
            where: { receiptId: { not: null } },
            select: { receiptId: true },
            transaction
        })) {
            if (row.receiptId != undefined) {
                named.add(row.receiptId);
            }
        }
        const res: KeptRowDivergence[] = [];
        const receipts: Repository<ExpenseReceipt> = inject<Repository<ExpenseReceipt>>(repositoryTokenFor(ExpenseReceipt));
        for await (const receipt of receipts.stream({ select: { id: true }, transaction })) {
            if (!named.has(receipt.id)) {
                res.push({
                    entity: ExpenseReceipt.name,
                    id: receipt.id,
                    sourceEntity: Expense.name,
                    sourceId: null,
                    reason: KeptRowDivergenceReason.SOURCE_MISSING,
                    message: `The receipt ${receipt.id} is kept, and no expense names it.`
                });
            }
        }
        return res;
    }

    /**
     * Resolves the bank matches that stand and pay an expense that is gone or a draft again.
     * @param transaction - The transaction to read in.
     * @returns The matches.
     */
    protected async resolveExpenseMatchDivergences(transaction: Transaction): Promise<KeptRowDivergence[]> {
        if (!this.declared.has(BankMatch)) {
            return [];
        }
        const matches: Pick<BankMatch, 'id' | 'targetId' | 'reversesMatchId'>[] = [];
        for await (const row of inject<Repository<BankMatch>>(repositoryTokenFor(BankMatch)).stream({
            where: { targetType: BankMatchTargetType.EXPENSE },
            select: { id: true, targetId: true, reversesMatchId: true },
            transaction
        })) {
            matches.push(row);
        }
        const reversed: Set<string> = new Set(matches.flatMap(m => m.reversesMatchId == undefined ? [] : [m.reversesMatchId]));
        const standing: typeof matches = matches.filter(m => m.reversesMatchId == undefined && !reversed.has(m.id));
        const expenses: Map<string, Pick<Expense, 'id' | 'documentNumber' | 'recordedAt'>> = new Map((await this.findInPages(
            [...new Set(standing.map(m => m.targetId))],
            async page => await this.expenseRepository.findAll({
                where: { id: { oneOf: page } },
                select: { id: true, documentNumber: true, recordedAt: true },
                limit: 'all',
                transaction
            })
        )).map(e => [e.id, e]));
        return standing.flatMap((match): KeptRowDivergence[] => {
            const expense: Pick<Expense, 'id' | 'documentNumber' | 'recordedAt'> | undefined = expenses.get(match.targetId);
            if (expense?.recordedAt != undefined) {
                return [];
            }
            return [
                {
                    entity: BankMatch.name,
                    id: match.id,
                    sourceEntity: Expense.name,
                    sourceId: match.targetId,
                    reason: expense == undefined ? KeptRowDivergenceReason.SOURCE_MISSING : KeptRowDivergenceReason.SOURCE_DRAFT,
                    message: expense == undefined
                        ? `The bank match ${match.id} pays the expense ${match.targetId}, which is gone.`
                        : `The bank match ${match.id} pays the expense ${expense.documentNumber}, which is a draft again.`
                }
            ];
        });
    }

    /**
     * Resolves the debits of entries, from their lines.
     * @param entries - The entries.
     * @param transaction - The transaction to read in.
     * @returns The debits of each, by its id.
     */
    protected async resolveEntryDebits(
        entries: Pick<JournalEntry, 'id' | 'fiscalYearId'>[],
        transaction: Transaction
    ): Promise<Map<string, BigNumber>> {
        const ids: Set<string> = new Set(entries.map(e => e.id));
        const res: Map<string, BigNumber> = new Map();
        // by the fiscal years rather than the ids of the entries, of which a year has more than a query takes
        for await (const line of this.lineRepository.stream({
            where: { fiscalYearId: { oneOf: [...new Set(entries.map(e => e.fiscalYearId))] } },
            select: { entryId: true, debit: true },
            transaction
        })) {
            if (ids.has(line.entryId) && line.debit != undefined) {
                res.set(line.entryId, NumberUtilities.add(res.get(line.entryId) ?? 0, line.debit));
            }
        }
        return res;
    }

    private resolveDebitTotal(lines: Pick<NewJournalEntryLine, 'debit'>[]): BigNumber {
        return lines.reduce((sum, line) => line.debit == undefined ? sum : NumberUtilities.add(sum, line.debit), new BigNumber(0));
    }

    private async findInPages<T>(values: string[], find: (page: string[]) => Promise<T[]>): Promise<T[]> {
        const res: T[] = [];
        // one page after the other, as the reads of one transaction run over one connection
        for (let start: number = 0; start < values.length; start += IDS_PER_READ) {
            res.push(...await find(values.slice(start, start + IDS_PER_READ)));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntryOf(sourceType: PostingSourceType, sourceId: string, transaction?: Transaction): Promise<JournalEntry | undefined> {
        return await this.entryRepository.findOne({ where: { sourceType, sourceId }, required: false, transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async postIssuedInvoices(invoices: Invoice[], transaction: RepositoryTransaction): Promise<void> {
        TransactionUtilities.validateNotSpanning(transaction, 'An invoice is posted into the journal, which is chained');
        // one after the other, as the writes of one transaction run over one connection
        for (const invoice of invoices) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(invoice.tenantId, async () => await this.postFor(
                { type: invoice.type === InvoiceType.CREDIT_NOTE ? PostingSourceType.CREDIT_NOTE : PostingSourceType.INVOICE, invoice },
                transaction
            ));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async postMatch(match: BankMatch, bankTransaction: BankTransaction, transaction: Transaction): Promise<void> {
        await this.postFor({ type: PostingSourceType.BANK_MATCH, match, bankTransaction }, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async postMatchReversal(reversal: BankMatch, original: BankMatch, transaction: Transaction): Promise<void> {
        if (await this.findSettings(transaction) == undefined) {
            return;
        }
        // none for a match confirmed before the tenant kept books, which has nothing to reverse
        const entry: JournalEntry | undefined = await this.findEntryOf(PostingSourceType.BANK_MATCH, original.id, transaction);
        if (entry == undefined) {
            return;
        }
        await this.journalService.reverse(
            entry.id,
            {
                // on the day the match was posted on, the day the transaction was booked, so that the reversal falls into
                // the period of the payment it undoes rather than the day someone noticed
                postingDate: entry.postingDate,
                text: $ts`Reversal of the bank match ${original.id}`,
                createdBy: reversal.confirmedBy,
                sourceType: PostingSourceType.BANK_MATCH,
                sourceId: reversal.id
            },
            transaction
        );
    }

    /**
     * Finds the settings of the books of the current tenant, which a tenant without keeps no books in the application:
     * nothing of it is posted, or, with `tenantsWithoutBooks` set to `refuse`, what would be posted is refused. So it is
     * with `never`, for a tenant whose row was written past its repository.
     * @param transaction - The transaction.
     * @returns The settings, or undefined for a tenant without books whose sources post nothing.
     * @throws A ConflictError for a tenant without books whose sources are refused.
     */
    protected async findSettings(transaction: Transaction): Promise<BookkeepingSettings | undefined> {
        const settings: BookkeepingSettings | undefined = await this.journalService.findSettings(transaction);
        if (settings == undefined && this.options.tenantsWithoutBooks !== 'post-nothing') {
            throw new ConflictError($ts`The bookkeeping settings of the tenant need to be created before anything of it is posted.`);
        }
        return settings;
    }

    /**
     * Resolves the id of a source, which its entry is stored with.
     * @param source - The source.
     * @returns The id.
     */
    protected resolveSourceId(source: PostingSource): string {
        switch (source.type) {
            case PostingSourceType.INVOICE:
            case PostingSourceType.CREDIT_NOTE: {
                return source.invoice.id;
            }
            case PostingSourceType.EXPENSE: {
                return source.expense.id;
            }
            case PostingSourceType.BANK_MATCH: {
                return source.match.id;
            }
        }
    }
}