import { ArchiveUtilities } from '../../../archive/archive.utilities';
import { type ChainVerification } from '../../../data-source/chain/chain-verification.model';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Where, type WhereFilter } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { WriteDataUtilities } from '../../../data-source/write-data.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { type EntityOrder } from '../../../entity/models/entity-order.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../bookkeeping-day.utilities';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { JournalEntryUtilities } from '../journal-entry.utilities';
import { type BookkeepingAccountBalance } from '../models/bookkeeping-account-balance.model';
import { type BookkeepingCarriedBalances } from '../models/bookkeeping-carried-balances.model';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { type BookkeepingAccountFilter } from '../models/bookkeeping-account-filter.model';
import { BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingClosingProposal } from '../models/bookkeeping-closing-proposal.model';
import { type BookkeepingObligation } from '../models/bookkeeping-obligation.model';
import { type BookkeepingReportContext } from '../models/bookkeeping-report-context.model';
import { type BookkeepingClosing } from '../models/bookkeeping-closing.model';
import { type BookkeepingCompany } from '../models/bookkeeping-company.model';
import { type BookkeepingLegalForm } from '../models/bookkeeping-legal-form.model';
import { type BookkeepingPluginOptions } from '../models/bookkeeping-plugin-options.model';
import { type BookkeepingSettingsChange } from '../models/bookkeeping-settings-change.model';
import { BookkeepingSettings, type BookkeepingSettingsCreateData } from '../models/bookkeeping-settings.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingVerificationProblem } from '../models/bookkeeping-verification-problem.model';
import { type BookkeepingVerification } from '../models/bookkeeping-verification.model';
import { type FiscalYearClosingResult } from '../models/fiscal-year-closing-result.model';
import { type FiscalYearChange } from '../models/fiscal-year-change.model';
import { type FiscalYearClosing } from '../models/fiscal-year-closing.model';
import { type FiscalYearReopeningResult } from '../models/fiscal-year-reopening-result.model';
import { type FiscalYearReopeningPosting } from '../models/fiscal-year-reopening.model';
import { FiscalYearEntrySourceType } from '../models/fiscal-year-entry-source-type.enum';
import { FiscalYear } from '../models/fiscal-year.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { type JournalEntryFilter } from '../models/journal-entry-filter.model';
import { JournalEntryLine } from '../models/journal-entry-line.model';
import { type JournalEntryPosting } from '../models/journal-entry-posting.model';
import { type JournalEntryReversalPosting } from '../models/journal-entry-reversal-posting.model';
import { type JournalEntryPage } from '../models/journal-entry-page.model';
import { JournalEntry } from '../models/journal-entry.model';
import { type NewBookkeepingSettings } from '../models/new-bookkeeping-settings.model';
import { type NewFiscalYear } from '../models/new-fiscal-year.model';
import { type NewJournalEntryLine } from '../models/new-journal-entry-line.model';
import { type BookkeepingConformanceServiceInterface } from './conformance/bookkeeping-conformance-service.interface';
import { BookkeepingConformanceUtilities } from './conformance/bookkeeping-conformance.utilities';
import { JournalServiceInterface } from './journal-service.interface';

/**
 * What an entry is created with: everything but what the repository and the chain fill in.
 */
type JournalEntryCreateData = OmitStrict<JournalEntry, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;

/**
 * What a line is created with.
 */
type JournalEntryLineCreateData = OmitStrict<JournalEntryLine, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;

/**
 * What a fiscal year is created with.
 */
type FiscalYearCreateRow = OmitStrict<FiscalYear, 'id' | 'tenantId'>;

/**
 * A line about to be created: a line posted, or one of the entry closing a fiscal year, with its role.
 */
type LineToCreate = NewJournalEntryLine & Pick<JournalEntryLine, 'role'>;

/**
 * An entry about to be created: what is posted, with lines that may have the role only the closing gives one, and the
 * entry it reverses, if any.
 */
type EntryToCreate = OmitStrict<JournalEntryPosting, 'lines'> & {
    /**
     * At least two lines, whose debits add up to their credits.
     */
    lines: LineToCreate[],
    /**
     * The id of the entry it reverses, or null for none.
     */
    reversesEntryId?: string | null
};

/**
 * What the lines of an entry add up to while the books are checked.
 */
type EntryTotals = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    debit: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    credit: BigNumber,
    /**
     * How many lines it has.
     */
    count: number
};

/**
 * How many ids of entries one read looks for, so that the reversals of many entries are read in pages.
 */
const ENTRY_IDS_PER_READ: number = 500;

/**
 * What lines add up to.
 */
type Sums = Pick<EntryTotals, 'debit' | 'credit'>;

/**
 * The order a page of the entries is in: by posting date, and by sequence within a day.
 */
const ENTRY_ORDER: EntityOrder<JournalEntry> = { postingDate: 'ASC', sequence: 'ASC' };

/**
 * Default implementation of the journal service.
 */
@Injectable({ register: 'onUse' })
export class JournalService implements JournalServiceInterface {
    // read when used, like the repositories of the bank services: ZibriBookkeepingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get settingsRepository(): Repository<BookkeepingSettings, BookkeepingSettingsCreateData> {
        return inject(repositoryTokenFor(BookkeepingSettings));
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get fiscalYearRepository(): Repository<FiscalYear, FiscalYearCreateRow> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get entryRepository(): Repository<JournalEntry, JournalEntryCreateData> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    private get lineRepository(): Repository<JournalEntryLine, JournalEntryLineCreateData> {
        return inject(repositoryTokenFor(JournalEntryLine));
    }

    private get conformanceServices(): BookkeepingConformanceServiceInterface[] {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES);
    }

    /**
     * The tenants whose lease each transaction of a caller holds until it ends.
     */
    private readonly leasedTransactions: WeakMap<Transaction, Set<string>> = new WeakMap();

    constructor(
        @Inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BookkeepingPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSettings(transaction?: Transaction): Promise<BookkeepingSettings | undefined> {
        return await this.settingsRepository.findOne({ required: false, transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createSettings(settings: NewBookkeepingSettings, transaction?: Transaction): Promise<BookkeepingSettings> {
        for (const form of settings.legalForms) {
            BookkeepingDayUtilities.validateDay(form.validFrom, 'validFrom');
        }
        return await this.runInTransaction(transaction, async started => {
            if (await this.findSettings(started) != undefined) {
                throw new ConflictError($ts`The books of the tenant have settings already, which are changed rather than created again.`);
            }
            const data: BookkeepingSettingsCreateData = {
                currency: settings.currency,
                legalForms: this.sortLegalForms(settings.legalForms),
                company: settings.company ?? null
            };
            await this.validateSettingsData(data);
            try {
                return await this.settingsRepository.create(data, { transaction: started });
            }
            catch (error) {
                // settings created meanwhile, which the check above could not see yet
                if (error instanceof UniqueConstraintViolationError) {
                    throw new ConflictError(
                        $ts`The books of the tenant have settings already, which are changed rather than created again.`,
                        { cause: error }
                    );
                }
                throw error;
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateSettings(change: BookkeepingSettingsChange, transaction?: Transaction): Promise<BookkeepingSettings> {
        if (change.legalForm != undefined) {
            BookkeepingDayUtilities.validateDay(change.legalForm.validFrom, 'validFrom');
        }
        return await this.runInTransaction(transaction, async started => {
            const settings: BookkeepingSettings = await this.resolveSettings(started);
            const currency: BookkeepingSettings['currency'] = change.currency ?? settings.currency;
            if (currency !== settings.currency && await this.fiscalYearRepository.exists({ transaction: started })) {
                throw new ConflictError(
                    $ts`The currency of the books needs to stay ${settings.currency}, as a fiscal year is kept in it.`
                );
            }
            const legalForms: BookkeepingLegalForm[] = change.legalForm == undefined
                ? settings.legalForms
                : [...settings.legalForms, await this.validateAppendedLegalForm(settings, change.legalForm, started)];
            // an absent company is kept, and null removes it
            const company: BookkeepingCompany | null = change.company === undefined ? settings.company ?? null : change.company;
            const data: BookkeepingSettingsCreateData = { currency, legalForms, company };
            // judged as a whole rather than step by step, so a legal form asking more of the company, such as a GmbH
            // following an e.K., is appended together with the company holding it. Nothing is written before every
            // check passed, and the transaction rolls back what a later failure would leave
            await this.validateSettingsData(data);
            if (change.legalForm != undefined) {
                // the open fiscal years the legal form applies to keep posting rules its conformances accept
                const changed: BookkeepingSettings = { ...settings, ...data };
                const affected: FiscalYear[] = await this.fiscalYearRepository.findAll({
                    where: { closedAt: null, end: { afterOrOn: change.legalForm.validFrom } },
                    limit: 'all',
                    transaction: started
                });
                for (const fiscalYear of affected) {
                    await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).validateRuleSets(fiscalYear, changed, started);
                }
            }
            // the company is replaced, and an object an update gives is merged into the stored one: what the company
            // before held and this one leaves out is written as null
            return await this.settingsRepository.updateById(
                settings.id,
                WriteDataUtilities.resolveReplacing(data, settings, BookkeepingSettings),
                { transaction: started }
            );
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async post(entry: JournalEntryPosting, transaction?: Transaction): Promise<JournalEntryDetails> {
        return await this.runInTransaction(transaction, async started => {
            const settings: BookkeepingSettings = await this.resolveSettings(started);
            BookkeepingDayUtilities.validateDay(entry.documentDate, 'documentDate');
            BookkeepingDayUtilities.validateDay(entry.postingDate, 'postingDate');
            JournalEntryUtilities.validateLines(
                entry.lines,
                inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).getCurrencyMinorUnits(settings.currency),
                settings.currency
            );
            const fiscalYear: FiscalYear = await this.resolveOpenFiscalYear(entry.postingDate, started);
            await this.validateAccounts(entry.lines, started);
            // the lines are built anew: only the closing gives a line a role, and a line handed in from code may hold
            // one beyond its type, which createEntry would store
            const lines: NewJournalEntryLine[] = entry.lines.map(line => ({ accountId: line.accountId, debit: line.debit ?? null, credit: line.credit ?? null }));
            return await this.createEntry(fiscalYear, { ...entry, lines }, true, started);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reverse(entryId: string, reversal: JournalEntryReversalPosting, transaction?: Transaction): Promise<JournalEntryDetails> {
        BookkeepingDayUtilities.validateDay(reversal.postingDate, 'postingDate');
        return await this.runInTransaction(transaction, async started => {
            const original: JournalEntryDetails = await this.resolveEntry(entryId, started);
            // the closing and the opening balances it carries into the next year are taken back together, by reopening
            // the year, which keeps the statements of the year and the balances of the next one in step
            if (original.entry.sourceType === FiscalYearEntrySourceType.CLOSING || original.entry.sourceType === FiscalYearEntrySourceType.OPENING) {
                throw new ConflictError([
                    $ts`The entry "${entryId}" closes a fiscal year or opens one with the balances of the one before, and is reversed only by reopening that fiscal year.`,
                    $ts`Reopen it with POST /fiscal-years/:id/reopening.`
                ]);
            }
            if (original.entry.reversesEntryId != undefined) {
                throw new ConflictError([
                    $ts`The entry "${entryId}" is a reversal, which is not reversed.`,
                    $ts`Post the corrected entry instead.`
                ]);
            }
            if (await this.entryRepository.exists({ where: { reversesEntryId: entryId }, transaction: started })) {
                throw new ConflictError($ts`The entry "${entryId}" is reversed already, and an entry is reversed at most once.`);
            }
            const lines: NewJournalEntryLine[] = JournalEntryUtilities.resolveMirrorLines(original.lines);
            const fiscalYear: FiscalYear = await this.resolveOpenFiscalYear(reversal.postingDate, started);
            await this.validateAccounts(lines, started);
            try {
                return await this.createEntry(
                    fiscalYear,
                    {
                        documentDate: reversal.postingDate,
                        postingDate: reversal.postingDate,
                        documentReference: original.entry.documentReference ?? null,
                        text: reversal.text,
                        lines,
                        createdBy: reversal.createdBy ?? null,
                        sourceType: reversal.sourceType ?? null,
                        sourceId: reversal.sourceId ?? null,
                        reversesEntryId: entryId
                    },
                    true,
                    started
                );
            }
            catch (error) {
                // a reversal of the same entry committed meanwhile, which the check above could not see yet
                if (error instanceof UniqueConstraintViolationError && error.properties.includes('reversesEntryId')) {
                    throw new ConflictError($ts`The entry "${entryId}" is reversed already, and an entry is reversed at most once.`, { cause: error });
                }
                throw error;
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(entryId: string): Promise<JournalEntryDetails> {
        return await this.resolveEntry(entryId, undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntries(page: number, limit: number, filter: JournalEntryFilter): Promise<JournalEntryPage> {
        await this.validateEntryFilter(filter);
        const { fiscalYearId, from, until, accountId } = filter;
        const where: Where<JournalEntry> = {
            ...fiscalYearId == undefined ? {} : { fiscalYearId },
            ...from == undefined && until == undefined ? {} : { postingDate: { afterOrOn: from, beforeOrOn: until } }
        };
        const entries: PaginationResult<JournalEntry> = accountId == undefined
            ? await this.entryRepository.findAllPaginated(page, limit, { where, order: ENTRY_ORDER })
            : await this.findEntriesOnAccount(page, limit, where, accountId);
        const lines: JournalEntryLine[] = entries.items.length
            ? await this.lineRepository.findAll({
                where: { entryId: { oneOf: entries.items.map(e => e.id) } },
                order: { chainSequence: 'ASC' },
                limit: 'all'
            })
            : [];
        const reversedBy: Map<string, string> = await this.resolveReversingEntryIds(entries.items.map(e => e.id));
        const totals: Sums = await this.resolveEntryTotals(where, accountId);
        return {
            totalAmount: entries.totalAmount,
            items: entries.items.map(entry => ({
                entry,
                lines: lines.filter(line => line.entryId === entry.id),
                reversedByEntryId: reversedBy.get(entry.id) ?? null
            })),
            debit: totals.debit,
            credit: totals.credit
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveReversingEntryIds(entryIds: string[], transaction?: Transaction): Promise<Map<string, string>> {
        const res: Map<string, string> = new Map();
        // read from the reversals, as an entry is never changed once it is posted: its reversesEntryId is unique. In
        // pages of ids, one after the other, as the reads of one transaction run over one connection
        for (let start: number = 0; start < entryIds.length; start += ENTRY_IDS_PER_READ) {
            const reversals: Pick<JournalEntry, 'id' | 'reversesEntryId'>[] = await this.entryRepository.findAll({
                where: { reversesEntryId: { oneOf: entryIds.slice(start, start + ENTRY_IDS_PER_READ) } },
                select: { id: true, reversesEntryId: true },
                limit: 'all',
                transaction
            });
            for (const reversal of reversals) {
                if (reversal.reversesEntryId != undefined) {
                    res.set(reversal.reversesEntryId, reversal.id);
                }
            }
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAccounts(filter: BookkeepingAccountFilter): Promise<BookkeepingAccount[]> {
        const search: string | undefined = filter.search?.trim();
        const where: WhereFilter<BookkeepingAccount> = filter.open == undefined ? {} : { closedAt: filter.open ? null : { not: null } };
        const escaped: string | undefined = search == undefined || search === '' ? undefined : FilterUtilities.escapeLike(search);
        return await this.accountRepository.findAll({
            // the number from its start, such as 12 for 1200, and the name anywhere in it
            where: escaped == undefined ? where : [{ ...where, number: { iLike: `${escaped}%` } }, { ...where, name: { iLike: `%${escaped}%` } }],
            order: { number: 'ASC' },
            limit: 'all'
        });
    }

    /**
     * Resolves what the lines of every entry of a filter add up to, on the account given, or on every account.
     * @param where - The filter of the entries.
     * @param accountId - The account the lines are counted on, every account when undefined.
     * @returns The debits and the credits.
     */
    protected async resolveEntryTotals(where: Where<JournalEntry>, accountId: string | undefined): Promise<Sums> {
        // the lines hold no posting date, and their amounts are added up here rather than by the data source, which
        // adds up no decimals of this precision: the ids of the entries, then the lines of their fiscal years
        const entryIds: Set<string> = new Set();
        const fiscalYearIds: Set<string> = new Set();
        for await (const entry of this.entryRepository.stream({ where, select: { id: true, fiscalYearId: true } })) {
            entryIds.add(entry.id);
            fiscalYearIds.add(entry.fiscalYearId);
        }
        let debit: BigNumber = new BigNumber(0);
        let credit: BigNumber = new BigNumber(0);
        if (!entryIds.size) {
            return { debit, credit };
        }
        for await (const line of this.lineRepository.stream({
            where: { fiscalYearId: { oneOf: [...fiscalYearIds] }, ...accountId == undefined ? {} : { accountId } },
            select: { entryId: true, debit: true, credit: true }
        })) {
            if (entryIds.has(line.entryId)) {
                debit = line.debit == undefined ? debit : NumberUtilities.add(debit, line.debit);
                credit = line.credit == undefined ? credit : NumberUtilities.add(credit, line.credit);
            }
        }
        return { debit, credit };
    }

    /**
     * Validates what a page of the entries is narrowed by.
     * @param filter - The filter.
     * @throws A BadRequestError for a `from` or `until` with a time, an `until` before `from`, or an account the
     * current tenant does not have.
     */
    protected async validateEntryFilter(filter: JournalEntryFilter): Promise<void> {
        const { from, until, accountId } = filter;
        if (from != undefined) {
            BookkeepingDayUtilities.validateDay(from, 'from');
        }
        if (until != undefined) {
            BookkeepingDayUtilities.validateDay(until, 'until');
        }
        if (from != undefined && until != undefined && until.getTime() < from.getTime()) {
            throw new BadRequestError($ts`The until needs to be on or after the from, ${BookkeepingDayUtilities.formatDay(from)}.`);
        }
        if (accountId != undefined && await this.accountRepository.findById(accountId, { required: false }) == undefined) {
            throw new BadRequestError($ts`The accountId needs to be an account of the books, and "${accountId}" is none.`);
        }
    }

    /**
     * Finds a page of the entries with a line on an account, of those matching.
     * @param page - The page, counting from 1.
     * @param limit - How many entries a page holds.
     * @param where - What the entries match beside.
     * @param accountId - The id of the account.
     * @returns The entries of the page, without their lines, and how many match.
     */
    protected async findEntriesOnAccount(
        page: number,
        limit: number,
        where: Where<JournalEntry>,
        accountId: string
    ): Promise<PaginationResult<JournalEntry>> {
        // the ids of the entries rather than a query naming them, of which an account has more than a query takes
        const onAccount: Set<string> = new Set();
        for await (const line of this.lineRepository.stream({ where: { accountId }, select: { entryId: true } })) {
            onAccount.add(line.entryId);
        }
        const matching: string[] = [];
        for await (const entry of this.entryRepository.stream({ where, select: { id: true }, order: ENTRY_ORDER })) {
            if (onAccount.has(entry.id)) {
                matching.push(entry.id);
            }
        }
        const ids: string[] = matching.slice((page - 1) * limit, page * limit);
        return {
            totalAmount: matching.length,
            items: ids.length ? await this.entryRepository.findAll({ where: { id: { oneOf: ids } }, order: ENTRY_ORDER, limit: 'all' }) : []
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createFiscalYear(fiscalYear: NewFiscalYear, transaction?: Transaction): Promise<FiscalYear> {
        return await this.runInTransaction(transaction, async started => {
            const [latest] = await this.fiscalYearRepository.findAll({ order: { end: 'DESC' }, limit: 1, transaction: started });
            return await this.createFiscalYearAfter(latest, fiscalYear, started);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateFiscalYear(fiscalYearId: string, change: FiscalYearChange, transaction?: Transaction): Promise<FiscalYear> {
        return await this.runInTransaction(transaction, async started => {
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId, { transaction: started });
            const data: Partial<Pick<FiscalYear, 'averageEmployees' | 'balanceSheetNote' | 'founded' | 'previousSizeClass'>> = {
                ...change.averageEmployees === undefined ? {} : { averageEmployees: change.averageEmployees },
                ...change.balanceSheetNote === undefined ? {} : { balanceSheetNote: change.balanceSheetNote },
                ...change.founded === undefined ? {} : { founded: change.founded },
                ...change.previousSizeClass === undefined ? {} : { previousSizeClass: change.previousSizeClass }
            };
            if (!Object.keys(data).length) {
                return fiscalYear;
            }
            // judged by the update, as a closing under way is: the closed year keeps what it was closed with
            const [updated] = await this.fiscalYearRepository.updateAll(
                { id: fiscalYear.id, closedAt: null },
                data,
                { transaction: started, returnUpdated: true }
            );
            if (updated == undefined) {
                const [start, end] = this.formatDays(fiscalYear);
                throw new ConflictError($ts`The fiscal year from ${start} to ${end} is closed, and stays as it was closed.`);
            }
            return updated;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveClosingProposals(fiscalYearId: string): Promise<BookkeepingClosingProposal[]> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        const settings: BookkeepingSettings = await this.resolveSettings(undefined);
        const closing: BookkeepingClosing = {
            settings,
            fiscalYear,
            legalForm: this.findLegalForm(settings, fiscalYear.end),
            balances: await this.resolveBalances(fiscalYear, undefined),
            transaction: undefined
        };
        const proposals: BookkeepingClosingProposal[][] = await Promise.all(this.resolveConformances(settings, fiscalYear).map(
            async conformance => (await conformance.resolveClosingProposals(closing)).map(entry => ({ conformance: conformance.name, entry }))
        ));
        return proposals.flat();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveObligations(fiscalYearId: string): Promise<BookkeepingObligation[]> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        if (fiscalYear.closedAt == undefined) {
            return [];
        }
        const settings: BookkeepingSettings = await this.resolveSettings(undefined);
        const context: BookkeepingReportContext = { settings, fiscalYear, legalForm: this.findLegalForm(settings, fiscalYear.end) };
        const obligations: BookkeepingObligation[][] = await Promise.all(
            this.resolveConformances(settings, fiscalYear).map(async conformance => await conformance.resolveObligations?.(context) ?? [])
        );
        return obligations.flat();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async closeFiscalYear(fiscalYearId: string, closing: FiscalYearClosing, transaction?: Transaction): Promise<FiscalYearClosingResult> {
        return await this.runInTransaction(transaction, async started => {
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId, { transaction: started });
            const [start, end] = this.formatDays(fiscalYear);
            if (fiscalYear.closedAt != undefined) {
                throw new ConflictError($ts`The fiscal year from ${start} to ${end} is closed already.`);
            }
            const settings: BookkeepingSettings = await this.resolveSettings(started);
            await this.validatePreviousClosed(fiscalYear, started);
            const resultAccount: BookkeepingAccount = await this.resolveResultAccount(closing.resultAccountId, started);

            // closed before its balances are read: the postings into it under way are waited for, and every one after
            // is refused, so the balances read are those it closes with
            const [closed] = await this.fiscalYearRepository.updateAll(
                { id: fiscalYear.id, closedAt: null },
                { closedAt: new Date() },
                { transaction: started, returnUpdated: true }
            );
            if (closed == undefined) {
                throw new ConflictError($ts`The fiscal year from ${start} to ${end} is closed already.`);
            }
            const balances: BookkeepingAccountBalance[] = await this.resolveBalances(closed, started);
            const context: BookkeepingClosing = {
                settings,
                fiscalYear: closed,
                legalForm: this.findLegalForm(settings, closed.end),
                balances,
                transaction: started
            };
            // one after the other, as the reads of one transaction run over one connection
            for (const conformance of this.resolveConformances(settings, closed)) {
                await conformance.validateClosing(context);
            }
            // the statements as they are at the closing, which its reports answer from then on, whatever the accounts
            // are mapped to later
            await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE).archiveStatements(closed, started);

            // the positions the result of the year is part of, in which each account appropriating it is closed too
            const resultPositions: string[] = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES)
                .flatMap(s => s.type === BookkeepingStatementType.BALANCE_SHEET && s.rollsUpFrom == undefined && s.resultPosition != undefined ? [s.resultPosition] : []);
            const closingLines: LineToCreate[] = JournalEntryUtilities.resolveClosingLines(balances, resultAccount.id, resultPositions);
            const closingBalances: BookkeepingAccountBalance[] = JournalEntryUtilities.resolveBalancesAfter(
                balances,
                closingLines,
                new Map([[resultAccount.id, resultAccount]])
            );
            const openingLines: NewJournalEntryLine[] = JournalEntryUtilities.resolveOpeningLines(closingBalances);
            // a source is posted once, so a year closed again after a reopening names its closing by its number
            const sourceId: string = closed.reopenings === 0 ? closed.id : `${closed.id}:closing-${closed.reopenings + 1}`;
            const closingEntry: JournalEntryDetails | null = closingLines.length
                ? await this.createEntry(
                    closed,
                    {
                        documentDate: closed.end,
                        postingDate: closed.end,
                        documentReference: null,
                        text: $ts`Closing of the fiscal year from ${start} to ${end}`,
                        lines: closingLines,
                        sourceType: FiscalYearEntrySourceType.CLOSING,
                        sourceId
                    },
                    // into the year it closes, which is closed for every other posting already
                    false,
                    started
                )
                : null;

            const next: FiscalYear = await this.findNextFiscalYear(closed, started) ?? await this.createFiscalYearAfter(closed, {}, started);
            const openingEntry: JournalEntryDetails | null = openingLines.length
                ? await this.createEntry(
                    next,
                    {
                        documentDate: next.start,
                        postingDate: next.start,
                        documentReference: null,
                        text: $ts`Opening balances from the fiscal year from ${start} to ${end}`,
                        lines: openingLines,
                        sourceType: FiscalYearEntrySourceType.OPENING,
                        sourceId
                    },
                    true,
                    started
                )
                : null;
            // read again for the sequences the entries drew
            const [closedYear, nextYear] = await Promise.all([
                this.fiscalYearRepository.findById(closed.id, { transaction: started }),
                this.fiscalYearRepository.findById(next.id, { transaction: started })
            ]);
            return { fiscalYear: closedYear, nextFiscalYear: nextYear, closingEntry, openingEntry };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reopenFiscalYear(fiscalYearId: string, reopening: FiscalYearReopeningPosting, transaction?: Transaction): Promise<FiscalYearReopeningResult> {
        return await this.runInTransaction(transaction, async started => {
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId, { transaction: started });
            const [start, end] = this.formatDays(fiscalYear);
            if (fiscalYear.closedAt == undefined) {
                throw new ConflictError($ts`The fiscal year from ${start} to ${end} is open, and only a closed one is reopened.`);
            }
            const next: FiscalYear | undefined = await this.findNextFiscalYear(fiscalYear, started);
            if (next?.closedAt != undefined) {
                const [nextStart, nextEnd] = this.formatDays(next);
                throw new ConflictError(
                    $ts`The fiscal year from ${nextStart} to ${nextEnd} needs to be reopened before the fiscal year before it, as it opened with its closing.`
                );
            }
            const settings: BookkeepingSettings = await this.resolveSettings(started);
            // one after the other, as the reads of one transaction run over one connection
            for (const conformance of this.resolveConformances(settings, fiscalYear)) {
                await conformance.validateReopening?.({
                    settings,
                    fiscalYear,
                    legalForm: this.findLegalForm(settings, fiscalYear.end),
                    forCorrection: reopening.forCorrection === true,
                    transaction: started
                });
            }

            // the row of the fiscal year is no archived one: what stays of the closing is in the journal, the entries
            // reversing it, and in the statements archived with it, which the count tells from those of a closing after
            const [reopened] = await this.fiscalYearRepository.updateAll(
                { id: fiscalYear.id },
                { closedAt: null, reopenings: fiscalYear.reopenings + 1 },
                { transaction: started, returnUpdated: true }
            );
            if (reopened == undefined) {
                throw new InternalError(`The fiscal year ${fiscalYear.id} could not be reopened.`);
            }
            const sourceId: string = `${fiscalYear.id}:reopening-${reopened.reopenings}`;
            const text: string = $ts`Reopening of the fiscal year from ${start} to ${end}: ${reopening.reason}`;
            // reversed as an entry is corrected: the mirror of its lines, which names it, with the kind of source of the
            // closing, so that what leaves the closing out of the balances of the year leaves its reversal out too
            const closingEntry: JournalEntryDetails | undefined = await this.findCurrentEntry(fiscalYear, FiscalYearEntrySourceType.CLOSING, started);
            const closingReversal: JournalEntryDetails | null = closingEntry == undefined
                ? null
                : await this.createEntry(
                    reopened,
                    {
                        documentDate: fiscalYear.end,
                        postingDate: fiscalYear.end,
                        documentReference: null,
                        text,
                        lines: JournalEntryUtilities.resolveMirrorLines(closingEntry.lines),
                        createdBy: reopening.createdBy ?? null,
                        sourceType: FiscalYearEntrySourceType.CLOSING,
                        sourceId,
                        reversesEntryId: closingEntry.entry.id
                    },
                    true,
                    started
                );
            // the opening balances the next year took from the closing, which its closing again posts anew
            const openingEntry: JournalEntryDetails | undefined = next == undefined
                ? undefined
                : await this.findCurrentEntry(next, FiscalYearEntrySourceType.OPENING, started);
            const openingReversal: JournalEntryDetails | null = next == undefined || openingEntry == undefined
                ? null
                : await this.createEntry(
                    next,
                    {
                        documentDate: next.start,
                        postingDate: next.start,
                        documentReference: null,
                        text,
                        lines: JournalEntryUtilities.resolveMirrorLines(openingEntry.lines),
                        createdBy: reopening.createdBy ?? null,
                        sourceType: FiscalYearEntrySourceType.OPENING,
                        sourceId,
                        reversesEntryId: openingEntry.entry.id
                    },
                    true,
                    started
                );
            // recorded once it is, as a reopening rolled back reopened nothing
            started.afterCommit(async () => {
                inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
                    action: AuditAction.BOOKKEEPING_FISCAL_YEAR_REOPENED,
                    outcome: AuditOutcome.SUCCESS,
                    subject: fiscalYear.id,
                    userId: reopening.createdBy ?? undefined
                });
                await Promise.resolve();
            });
            // read again for the sequences the entries drew
            const [reopenedYear, nextYear] = await Promise.all([
                this.fiscalYearRepository.findById(fiscalYear.id, { transaction: started }),
                next == undefined ? undefined : this.fiscalYearRepository.findById(next.id, { transaction: started })
            ]);
            return { fiscalYear: reopenedYear, nextFiscalYear: nextYear ?? null, closingReversal, openingReversal };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCarriedBalances(fiscalYearId: string, transaction?: Transaction): Promise<BookkeepingCarriedBalances> {
        const equity: BookkeepingAccount[] = await this.accountRepository.findAll({ where: { type: BookkeepingAccountType.EQUITY }, limit: 'all', transaction });
        const carryForward: Set<string> = new Set(equity.filter(a => BookkeepingStatementUtilities.isCarryForwardAccount(a)).map(a => a.id));
        // each opening entry with the reversals of those a reopening of the year before took back, which add up to the
        // opening balances of its latest closing
        const openings: JournalEntry[] = await this.entryRepository.findAll({
            where: { fiscalYearId, sourceType: FiscalYearEntrySourceType.OPENING },
            limit: 'all',
            transaction
        });
        // the balances of books kept elsewhere carried over by hand, whichever entry and day of the year they are in
        const carriedOver: JournalEntryLine[] = carryForward.size
            ? await this.lineRepository.findAll({ where: { fiscalYearId, accountId: { oneOf: [...carryForward] } }, limit: 'all', transaction })
            : [];
        const entryIds: string[] = [...new Set([...openings.map(o => o.id), ...carriedOver.map(l => l.entryId)])];
        if (!entryIds.length) {
            return { balances: [], entryIds };
        }
        const sums: Map<string, Pick<BookkeepingAccountBalance, 'debit' | 'credit'>> = new Map();
        const lines: JournalEntryLine[] = await this.lineRepository.findAll({ where: { entryId: { oneOf: entryIds } }, limit: 'all', transaction });
        // the carry-forward account is the counter account of what is carried over, not a balance of its own
        for (const line of lines.filter(l => !carryForward.has(l.accountId))) {
            const sum: Pick<BookkeepingAccountBalance, 'debit' | 'credit'> = sums.get(line.accountId) ?? { debit: new BigNumber(0), credit: new BigNumber(0) };
            sums.set(line.accountId, { debit: NumberUtilities.add(sum.debit, line.debit ?? 0), credit: NumberUtilities.add(sum.credit, line.credit ?? 0) });
        }
        const accounts: BookkeepingAccount[] = sums.size
            ? await this.accountRepository.findAll({ where: { id: { oneOf: [...sums.keys()] } }, limit: 'all', transaction })
            : [];
        const balances: BookkeepingAccountBalance[] = JournalEntryUtilities.sortBalances(accounts.map(account => ({
            account,
            debit: sums.get(account.id)?.debit ?? new BigNumber(0),
            credit: sums.get(account.id)?.credit ?? new BigNumber(0)
        })));
        return { balances, entryIds };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveVerification(): Promise<BookkeepingVerification> {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(JournalEntry);
        }
        const chains: [ChainVerification, ChainVerification] = await Promise.all([
            inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE).resolveChainVerification(JournalEntry, tenantId),
            inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE).resolveChainVerification(JournalEntryLine, tenantId)
        ]);
        const [entryChain, lineChain] = chains;
        const problems: BookkeepingVerificationProblem[] = [];
        if (!entryChain.intact) {
            const entry: JournalEntry | undefined = await this.entryRepository.findOne({
                where: { chainSequence: entryChain.brokenAtSequence },
                required: false
            });
            problems.push({ entryId: entry?.id ?? null, lineId: null, reason: entryChain.reason });
        }
        if (!lineChain.intact) {
            const line: JournalEntryLine | undefined = await this.lineRepository.findOne({
                where: { chainSequence: lineChain.brokenAtSequence },
                required: false
            });
            problems.push({ entryId: line?.entryId ?? null, lineId: line?.id ?? null, reason: lineChain.reason });
        }
        problems.push(...await this.findUnbalancedEntries());
        return {
            intact: !problems.length,
            newestEntrySequence: entryChain.intact ? entryChain.newestSequence : null,
            newestEntryHash: entryChain.intact ? entryChain.newestHash : null,
            newestLineSequence: lineChain.intact ? lineChain.newestSequence : null,
            newestLineHash: lineChain.intact ? lineChain.newestHash : null,
            problems
        };
    }

    /**
     * Runs work writing the books of the current tenant in the transaction given, or in one of its own, once the
     * writes of the tenant before it are done.
     * @param transaction - The transaction of the caller, if any.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A NoActiveTenantError outside a tenant.
     */
    protected async runInTransaction<T>(transaction: Transaction | undefined, work: (transaction: Transaction) => Promise<T>): Promise<T> {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(JournalEntry);
        }
        // a caller writing the books twice in its transaction, such as correcting an expense by a reversal and a new
        // entry, holds the lease of the tenant from its first write until the transaction ends. Taking it again would
        // wait for that end, which never comes
        if (transaction != undefined && this.leasedTransactions.get(transaction)?.has(tenantId) === true) {
            return await work(transaction);
        }
        // one write of a tenant's books at a time, held until its transaction ends, as BankStatementService imports:
        // the entries and lines of a tenant are chains, and a row linked inside a caller's transaction is not linked
        // again when another writer took its place meanwhile, as one of two entries posted at once would.
        // The sequence of a fiscal year stays an increment in the transaction, which rolls back with the entry
        const res: T | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            {
                key: `zibri.bookkeeping:${tenantId}`,
                mode: 'wait',
                leaseInMs: Ms.MINUTE,
                acquireTimeoutInMs: Ms.MINUTE * 5,
                heldUntil: transaction
            },
            async () => {
                if (transaction == undefined) {
                    return await this.entryRepository.dataSource.runInTransaction(work, { maxAttempts: 3 });
                }
                this.leasedTransactions.set(transaction, (this.leasedTransactions.get(transaction) ?? new Set()).add(tenantId));
                return await work(transaction);
            }
        );
        if (res === undefined) {
            throw new InternalError('Could not take the lease to write the books.');
        }
        return res;
    }

    /**
     * Resolves the settings of the books of the current tenant.
     * @param transaction - The transaction, if any.
     * @returns The settings.
     * @throws A ConflictError for a tenant that keeps no books.
     */
    protected async resolveSettings(transaction: Transaction | undefined): Promise<BookkeepingSettings> {
        const settings: BookkeepingSettings | undefined = await this.findSettings(transaction);
        if (settings == undefined) {
            throw new ConflictError($ts`The books of the tenant need settings, with the currency they are kept in, before they are kept.`);
        }
        return settings;
    }

    /**
     * Validates settings about to be stored by the conformances of each legal form of their history, such as that a
     * corporation names its register.
     * @param settings - The settings.
     * @throws What a conformance throws.
     */
    protected async validateSettingsData(settings: BookkeepingSettingsCreateData): Promise<void> {
        const legalForms: string[] = [...new Set(settings.legalForms.map(form => form.legalForm))];
        for (const legalForm of legalForms) {
            for (const conformance of this.conformanceServices.filter(service => service.isApplicable(legalForm))) {
                await conformance.validateSettings?.(settings, legalForm);
            }
        }
    }

    /**
     * Validates a legal form appended to the history of the books.
     * @param settings - The settings of the books.
     * @param legalForm - The legal form.
     * @param transaction - The transaction.
     * @returns The legal form.
     * @throws A ConflictError for a legal form valid from a day on or before the latest of the history or the end of
     * the last closed fiscal year, whose legal form is never rewritten.
     */
    protected async validateAppendedLegalForm(
        settings: BookkeepingSettings,
        legalForm: BookkeepingLegalForm,
        transaction: Transaction
    ): Promise<BookkeepingLegalForm> {
        const day: string = BookkeepingDayUtilities.formatDay(legalForm.validFrom);
        const latest: BookkeepingLegalForm | undefined = this.sortLegalForms(settings.legalForms).at(-1);
        if (latest != undefined && legalForm.validFrom.getTime() <= latest.validFrom.getTime()) {
            const latestDay: string = BookkeepingDayUtilities.formatDay(latest.validFrom);
            throw new ConflictError(
                $ts`The legal form valid from ${day} needs to be valid from after ${latestDay}, the day the latest legal form is valid from.`
            );
        }
        const [lastClosed] = await this.fiscalYearRepository.findAll({
            where: { closedAt: { not: null } },
            order: { end: 'DESC' },
            limit: 1,
            transaction
        });
        if (lastClosed != undefined && legalForm.validFrom.getTime() <= lastClosed.end.getTime()) {
            const end: string = BookkeepingDayUtilities.formatDay(lastClosed.end);
            throw new ConflictError(
                $ts`The legal form valid from ${day} needs to be valid from after ${end}, the end of the last closed fiscal year.`
            );
        }
        return { legalForm: legalForm.legalForm, validFrom: legalForm.validFrom };
    }

    /**
     * Creates an entry and its lines, numbered with the next sequence of its fiscal year.
     * @param fiscalYear - The fiscal year the entry is posted into.
     * @param entry - The entry, validated.
     * @param requireOpen - Whether the fiscal year needs to be open, which it is for every entry but the one closing it.
     * @param transaction - The transaction.
     * @returns The entry and its lines.
     * @throws A ConflictError for a source posted already.
     */
    protected async createEntry(
        fiscalYear: FiscalYear,
        entry: EntryToCreate,
        requireOpen: boolean,
        transaction: Transaction
    ): Promise<JournalEntryDetails> {
        if (entry.sourceType != undefined && entry.sourceId != undefined) {
            await this.validateNotPosted(entry.sourceType, entry.sourceId, transaction);
        }
        const sequence: number = await this.drawSequence(fiscalYear, requireOpen, transaction);
        const retainUntil: Date = ArchiveUtilities.resolveRetainUntil(
            fiscalYear.end,
            { retention: this.options.retention, from: 'endOfYear' },
            inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
        );
        let created: JournalEntry;
        try {
            created = await this.entryRepository.create(
                {
                    fiscalYearId: fiscalYear.id,
                    sequence,
                    documentDate: entry.documentDate,
                    postingDate: entry.postingDate,
                    documentReference: entry.documentReference ?? null,
                    text: entry.text,
                    createdBy: entry.createdBy ?? null,
                    reversesEntryId: entry.reversesEntryId ?? null,
                    sourceType: entry.sourceType ?? null,
                    sourceId: entry.sourceId ?? null,
                    postedAt: new Date(),
                    retainUntil
                },
                { transaction }
            );
        }
        catch (error) {
            // an entry of the same source committed meanwhile, which the check above could not see yet
            if (error instanceof UniqueConstraintViolationError && error.properties.includes('sourceId')) {
                const sourceType: string = entry.sourceType ?? '';
                const sourceId: string = entry.sourceId ?? '';
                throw new ConflictError($ts`The source ${sourceType} "${sourceId}" is posted already, and a source is posted once.`, { cause: error });
            }
            throw error;
        }
        const lines: JournalEntryLine[] = await this.lineRepository.createAll(
            entry.lines.map(line => ({
                entryId: created.id,
                fiscalYearId: fiscalYear.id,
                accountId: line.accountId,
                debit: line.debit ?? null,
                credit: line.credit ?? null,
                role: line.role ?? null,
                retainUntil
            })),
            { transaction }
        );
        // just posted, so nothing reverses it yet
        return { entry: created, lines, reversedByEntryId: null };
    }

    /**
     * Validates that nothing was posted for a source yet.
     * @param sourceType - The kind of source, such as `invoicing.invoice`.
     * @param sourceId - The id of the source.
     * @param transaction - The transaction.
     * @throws A ConflictError when an entry of it exists.
     */
    protected async validateNotPosted(sourceType: string, sourceId: string, transaction: Transaction): Promise<void> {
        if (await this.entryRepository.exists({ where: { sourceType, sourceId }, transaction })) {
            throw new ConflictError($ts`The source ${sourceType} "${sourceId}" is posted already, and a source is posted once.`);
        }
    }

    /**
     * Draws the next sequence of a fiscal year, in the transaction of the entry.
     * @param fiscalYear - The fiscal year.
     * @param requireOpen - Whether the fiscal year needs to be open.
     * @param transaction - The transaction of the entry.
     * @returns The sequence.
     * @throws A ConflictError when the fiscal year needs to be open and was closed meanwhile.
     */
    protected async drawSequence(fiscalYear: FiscalYear, requireOpen: boolean, transaction: Transaction): Promise<number> {
        // One increment, for the reason InvoiceNumberService.resolveCounter draws its counter with one: reading the
        // sequence and writing it back lets two entries posted at once both take it. In the caller's transaction, so
        // an entry rolled back takes its sequence with it and leaves no gap. It holds the fiscal year until the
        // transaction ends, which also has a posting and the closing of the year wait for each other: the filter on
        // closedAt is judged once the other is done
        const [drawn] = await this.fiscalYearRepository.updateAll(
            requireOpen ? { id: fiscalYear.id, closedAt: null } : { id: fiscalYear.id },
            { lastSequence: { increment: 1 } },
            { transaction, returnUpdated: true }
        );
        if (drawn == undefined) {
            const [start, end] = this.formatDays(fiscalYear);
            throw new ConflictError(
                $ts`The posting date needs to fall into an open fiscal year, and the fiscal year from ${start} to ${end} is closed.`
            );
        }
        return drawn.lastSequence;
    }

    /**
     * Resolves the open fiscal year a posting date falls into.
     * @param postingDate - The posting date.
     * @param transaction - The transaction.
     * @returns The fiscal year.
     * @throws A ConflictError when it falls into no fiscal year, or into a closed one.
     */
    protected async resolveOpenFiscalYear(postingDate: Date, transaction: Transaction): Promise<FiscalYear> {
        const fiscalYear: FiscalYear | undefined = await this.fiscalYearRepository.findOne({
            where: { start: { beforeOrOn: postingDate }, end: { afterOrOn: postingDate } },
            required: false,
            transaction
        });
        const day: string = BookkeepingDayUtilities.formatDay(postingDate);
        if (fiscalYear == undefined) {
            throw new ConflictError($ts`The posting date ${day} needs to fall into a fiscal year, and none covers it.`);
        }
        if (fiscalYear.closedAt != undefined) {
            const [start, end] = this.formatDays(fiscalYear);
            throw new ConflictError(
                $ts`The posting date ${day} needs to fall into an open fiscal year, and the fiscal year from ${start} to ${end} is closed.`
            );
        }
        return fiscalYear;
    }

    /**
     * Validates that every line of an entry is booked on an open account.
     * @param lines - The lines.
     * @param transaction - The transaction.
     * @throws A ConflictError naming the first line that is not.
     */
    protected async validateAccounts(lines: NewJournalEntryLine[], transaction: Transaction): Promise<void> {
        const ids: string[] = [...new Set(lines.map(line => line.accountId))];
        const accounts: BookkeepingAccount[] = await this.accountRepository.findAll({
            where: { id: { oneOf: ids } },
            limit: 'all',
            transaction
        });
        const byId: Map<string, BookkeepingAccount> = new Map(accounts.map(account => [account.id, account]));
        for (const [index, line] of lines.entries()) {
            const position: number = index + 1;
            const account: BookkeepingAccount | undefined = byId.get(line.accountId);
            if (account == undefined) {
                throw new ConflictError($ts`Line ${position} needs to name an account of the books, and "${line.accountId}" is none.`);
            }
            if (account.closedAt != undefined) {
                throw new ConflictError(
                    $ts`Line ${position} needs to name an open account, and the account ${account.number} ${account.name} is closed.`
                );
            }
        }
    }

    /**
     * Resolves an entry with its lines.
     * @param entryId - The id of the entry.
     * @param transaction - The transaction, if any.
     * @returns The entry and its lines.
     */
    protected async resolveEntry(entryId: string, transaction: Transaction | undefined): Promise<JournalEntryDetails> {
        const entry: JournalEntry = await this.entryRepository.findById(entryId, { transaction });
        const lines: JournalEntryLine[] = await this.lineRepository.findAll({
            where: { entryId },
            order: { chainSequence: 'ASC' },
            limit: 'all',
            transaction
        });
        const reversedBy: Map<string, string> = await this.resolveReversingEntryIds([entryId], transaction);
        return { entry, lines, reversedByEntryId: reversedBy.get(entryId) ?? null };
    }

    /**
     * Creates the fiscal year after the latest one, which starts with a copy of the posting rules valid at the end of
     * that one.
     * @param latest - The latest fiscal year, or undefined for books without one.
     * @param fiscalYear - The fiscal year to create.
     * @param transaction - The transaction.
     * @returns The fiscal year.
     * @throws A BadRequestError for a first fiscal year without a start, a day with a time, or an end before the start.
     * @throws A ConflictError for a fiscal year that does not start the day after the latest one ends.
     */
    protected async createFiscalYearAfter(
        latest: FiscalYear | undefined,
        fiscalYear: NewFiscalYear,
        transaction: Transaction
    ): Promise<FiscalYear> {
        const expected: Date | undefined = latest == undefined ? undefined : BookkeepingDayUtilities.resolveNextDay(latest.end);
        const start: Date | undefined = fiscalYear.start ?? expected;
        if (start == undefined) {
            throw new BadRequestError($ts`The first fiscal year needs to name its start.`);
        }
        BookkeepingDayUtilities.validateDay(start, 'start');
        if (latest != undefined && expected != undefined && start.getTime() !== expected.getTime()) {
            const [latestStart, latestEnd] = this.formatDays(latest);
            throw new ConflictError([
                // eslint-disable-next-line stylistic/max-len
                $ts`The fiscal year needs to start on ${BookkeepingDayUtilities.formatDay(expected)}, the day after the fiscal year from ${latestStart} to ${latestEnd} ends.`,
                $ts`The fiscal years of a tenant neither overlap nor leave a gap.`
            ]);
        }
        const end: Date = fiscalYear.end ?? BookkeepingDayUtilities.resolveDefaultEnd(start, latest == undefined);
        BookkeepingDayUtilities.validateDay(end, 'end');
        if (end.getTime() < start.getTime()) {
            throw new BadRequestError($ts`The end needs to be on or after the start, ${BookkeepingDayUtilities.formatDay(start)}.`);
        }
        this.validateConformanceNames(fiscalYear.conformances ?? []);
        const created: FiscalYear = await this.fiscalYearRepository.create(
            {
                start,
                end,
                closedAt: null,
                conformances: fiscalYear.conformances ?? null,
                averageEmployees: fiscalYear.averageEmployees ?? null,
                balanceSheetNote: fiscalYear.balanceSheetNote ?? null,
                founded: fiscalYear.founded ?? null,
                previousSizeClass: fiscalYear.previousSizeClass ?? null,
                lastSequence: 0,
                reopenings: 0
            },
            { transaction }
        );
        if (latest != undefined) {
            await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).copyRuleSet(latest, created, transaction);
        }
        return created;
    }

    /**
     * Finds the entry of a fiscal year its closing posted, or of the opening balances of the closing before it, that
     * counts: the latest of its kind that no reopening reversed, and that is no reversal itself.
     * @param fiscalYear - The fiscal year.
     * @param sourceType - The kind of entry.
     * @param transaction - The transaction.
     * @returns The entry with its lines, or undefined for none.
     */
    protected async findCurrentEntry(
        fiscalYear: FiscalYear,
        sourceType: FiscalYearEntrySourceType,
        transaction: Transaction
    ): Promise<JournalEntryDetails | undefined> {
        const entries: JournalEntry[] = await this.entryRepository.findAll({
            where: { fiscalYearId: fiscalYear.id, sourceType },
            order: { sequence: 'ASC' },
            limit: 'all',
            transaction
        });
        const reversed: Set<string> = new Set(entries.flatMap(e => e.reversesEntryId ?? []));
        const current: JournalEntry | undefined = entries.filter(e => e.reversesEntryId == undefined && !reversed.has(e.id)).at(-1);
        return current == undefined ? undefined : await this.resolveEntry(current.id, transaction);
    }

    /**
     * Finds the fiscal year after one.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction.
     * @returns The fiscal year starting the day after it ends, or undefined when there is none yet.
     */
    protected async findNextFiscalYear(fiscalYear: FiscalYear, transaction: Transaction): Promise<FiscalYear | undefined> {
        return await this.fiscalYearRepository.findOne({
            where: { start: BookkeepingDayUtilities.resolveNextDay(fiscalYear.end) },
            required: false,
            transaction
        });
    }

    /**
     * Validates that the fiscal year before one is closed, whose closing balances it opens with.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction.
     * @throws A ConflictError when it is open.
     */
    protected async validatePreviousClosed(fiscalYear: FiscalYear, transaction: Transaction): Promise<void> {
        const previous: FiscalYear | undefined = await this.fiscalYearRepository.findOne({
            where: { end: BookkeepingDayUtilities.resolvePreviousDay(fiscalYear.start) },
            required: false,
            transaction
        });
        if (previous != undefined && previous.closedAt == undefined) {
            const [start, end] = this.formatDays(previous);
            throw new ConflictError($ts`The fiscal year from ${start} to ${end} needs to be closed before the fiscal year after it.`);
        }
    }

    /**
     * Resolves the account the result of a fiscal year is carried into.
     * @param accountId - The id of the account.
     * @param transaction - The transaction.
     * @returns The account.
     * @throws A ConflictError for an account that is not an equity account of the books.
     */
    protected async resolveResultAccount(accountId: string, transaction: Transaction): Promise<BookkeepingAccount> {
        const account: BookkeepingAccount | undefined = await this.accountRepository.findOne({
            where: { id: accountId },
            required: false,
            transaction
        });
        if (account?.type !== BookkeepingAccountType.EQUITY) {
            throw new ConflictError($ts`The result account needs to be an equity account of the books.`);
        }
        return account;
    }

    /**
     * Resolves what the lines of a fiscal year add up to on each account.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction, if any.
     * @returns The balances, by the number of their account.
     */
    protected async resolveBalances(fiscalYear: FiscalYear, transaction: Transaction | undefined): Promise<BookkeepingAccountBalance[]> {
        const sums: Map<string, Pick<BookkeepingAccountBalance, 'debit' | 'credit'>> = new Map();
        for await (const line of this.lineRepository.stream({
            where: { fiscalYearId: fiscalYear.id },
            select: { accountId: true, debit: true, credit: true },
            transaction
        })) {
            const sum: Pick<BookkeepingAccountBalance, 'debit' | 'credit'> = sums.get(line.accountId)
                ?? { debit: new BigNumber(0), credit: new BigNumber(0) };
            sums.set(line.accountId, {
                debit: line.debit == undefined ? sum.debit : NumberUtilities.add(sum.debit, line.debit),
                credit: line.credit == undefined ? sum.credit : NumberUtilities.add(sum.credit, line.credit)
            });
        }
        if (!sums.size) {
            return [];
        }
        const accounts: BookkeepingAccount[] = await this.accountRepository.findAll({
            where: { id: { oneOf: [...sums.keys()] } },
            limit: 'all',
            transaction
        });
        return JournalEntryUtilities.sortBalances(accounts.map(account => ({
            account,
            debit: sums.get(account.id)?.debit ?? new BigNumber(0),
            credit: sums.get(account.id)?.credit ?? new BigNumber(0)
        })));
    }

    /**
     * Resolves the conformances that apply to a fiscal year: those it names, or else those that apply to the legal
     * form the tenant has at its end.
     * @param settings - The settings of the books.
     * @param fiscalYear - The fiscal year.
     * @returns The conformance services.
     */
    protected resolveConformances(settings: BookkeepingSettings, fiscalYear: FiscalYear): BookkeepingConformanceServiceInterface[] {
        return BookkeepingConformanceUtilities.resolveConformances(this.conformanceServices, settings, fiscalYear);
    }

    /**
     * Validates that conformances are registered.
     * @param names - The names of the conformances.
     * @throws A ConflictError naming the first one that is not.
     */
    protected validateConformanceNames(names: string[]): void {
        BookkeepingConformanceUtilities.validateConformanceNames(this.conformanceServices, names);
    }

    /**
     * Finds the legal form the tenant has on a day: the latest of its history valid from that day or before.
     * @param settings - The settings of the books.
     * @param day - The day.
     * @returns The legal form, or undefined for a tenant of none then.
     */
    protected findLegalForm(settings: BookkeepingSettings, day: Date): string | undefined {
        return BookkeepingConformanceUtilities.findLegalForm(settings, day);
    }

    /**
     * Sorts the history of a legal form, the earliest first.
     * @param legalForms - The history.
     * @returns A sorted copy.
     */
    protected sortLegalForms(legalForms: BookkeepingLegalForm[]): BookkeepingLegalForm[] {
        return BookkeepingConformanceUtilities.sortLegalForms(legalForms);
    }

    /**
     * Finds the entries of the current tenant that do not have at least two lines whose debits add up to their
     * credits.
     * @returns A problem for each of them.
     */
    protected async findUnbalancedEntries(): Promise<BookkeepingVerificationProblem[]> {
        const totals: Map<string, EntryTotals> = new Map();
        for await (const line of this.lineRepository.stream({ select: { entryId: true, debit: true, credit: true } })) {
            const total: EntryTotals = totals.get(line.entryId) ?? { debit: new BigNumber(0), credit: new BigNumber(0), count: 0 };
            totals.set(line.entryId, {
                debit: line.debit == undefined ? total.debit : NumberUtilities.add(total.debit, line.debit),
                credit: line.credit == undefined ? total.credit : NumberUtilities.add(total.credit, line.credit),
                count: total.count + 1
            });
        }
        const res: BookkeepingVerificationProblem[] = [];
        for await (const entry of this.entryRepository.stream({ select: { id: true }, order: { chainSequence: 'ASC' } })) {
            const total: EntryTotals = totals.get(entry.id) ?? { debit: new BigNumber(0), credit: new BigNumber(0), count: 0 };
            if (total.count < 2) {
                res.push({ entryId: entry.id, lineId: null, reason: $ts`The entry has ${total.count} lines, and needs at least 2.` });
            }
            else if (NumberUtilities.compare(total.debit, total.credit) !== 0) {
                res.push({
                    entryId: entry.id,
                    lineId: null,
                    reason: $ts`The debits of the entry, ${total.debit.toFixed()}, do not add up to its credits, ${total.credit.toFixed()}.`
                });
            }
        }
        return res;
    }

    /**
     * Formats the first and the last day of a fiscal year, such as `2026-01-01` and `2026-12-31`.
     * @param fiscalYear - The fiscal year.
     * @returns The days.
     */
    protected formatDays(fiscalYear: Pick<FiscalYear, 'start' | 'end'>): [string, string] {
        return [BookkeepingDayUtilities.formatDay(fiscalYear.start), BookkeepingDayUtilities.formatDay(fiscalYear.end)];
    }
}
