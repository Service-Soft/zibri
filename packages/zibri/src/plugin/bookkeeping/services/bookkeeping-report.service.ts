import { type Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { ArchiveUtilities } from '../../../archive/archive.utilities';
import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type FileRecord } from '../../../file/file-record.model';
import { MimeType } from '../../../http/mime-type.enum';
import { type TranslationToken } from '../../../localization/translate.function';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type LocaleCode } from '../../../localization/models/locale-code.model';
import { $ts } from '../../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../bookkeeping-day.utilities';
import { BookkeepingStatementUtilities } from '../bookkeeping-statement.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { JournalEntryUtilities } from '../journal-entry.utilities';
import { type BookkeepingAccountAmount } from '../models/bookkeeping-account-amount.model';
import { type BookkeepingAccountBalance } from '../models/bookkeeping-account-balance.model';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingJournalReport } from '../models/bookkeeping-journal-report.model';
import { type BookkeepingLedgerLine } from '../models/bookkeeping-ledger-line.model';
import { type BookkeepingLedgerReport } from '../models/bookkeeping-ledger-report.model';
import { type BookkeepingRevenueReport } from '../models/bookkeeping-revenue-report.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { type BookkeepingStatementFormChoice } from '../models/bookkeeping-statement-form-choice.model';
import { type BookkeepingStatementFormChoices } from '../models/bookkeeping-statement-form-choices.model';
import { type BookkeepingStatementForms } from '../models/bookkeeping-statement-forms.model';
import { type BookkeepingStatementPosition } from '../models/bookkeeping-statement-position.model';
import { type BookkeepingStatementStructure } from '../models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';
import { type BookkeepingTrialBalanceRow } from '../models/bookkeeping-trial-balance-row.model';
import { type BookkeepingTrialBalance } from '../models/bookkeeping-trial-balance.model';
import { FiscalYearEntrySourceType } from '../models/fiscal-year-entry-source-type.enum';
import { FiscalYearStatement, type FiscalYearStatementCreateData } from '../models/fiscal-year-statement.model';
import { FiscalYear } from '../models/fiscal-year.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { JournalEntryLine } from '../models/journal-entry-line.model';
import { JournalEntry } from '../models/journal-entry.model';
import { type BookkeepingReportServiceInterface } from './bookkeeping-report-service.interface';
import { type BookkeepingConformanceServiceInterface } from './conformance/bookkeeping-conformance-service.interface';
import { BookkeepingConformanceUtilities } from './conformance/bookkeeping-conformance.utilities';

/**
 * The debits and the credits of one account.
 */
type Sums = Pick<BookkeepingAccountBalance, 'debit' | 'credit'>;

/**
 * Default implementation of the report service.
 */
// every report reads the rows of the journal as they were posted, which never change: a report of a closed fiscal
// year, into which nothing is posted, answers the same every time. The entry closing a year is left out of its
// balances, so its statements read the same before and after the closing
@Injectable({ register: 'onUse' })
export class BookkeepingReportService implements BookkeepingReportServiceInterface {
    // read when used, like the repositories of the journal service
    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get entryRepository(): Repository<JournalEntry> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    private get lineRepository(): Repository<JournalEntryLine> {
        return inject(repositoryTokenFor(JournalEntryLine));
    }

    private get statementRepository(): Repository<FiscalYearStatement, FiscalYearStatementCreateData> {
        return inject(repositoryTokenFor(FiscalYearStatement));
    }

    private get structures(): BookkeepingStatementStructure[] {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES);
    }

    private get conformanceServices(): BookkeepingConformanceServiceInterface[] {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveJournal(from: Date, until: Date): Promise<BookkeepingJournalReport> {
        this.validateRange(from, until);
        const entries: JournalEntry[] = await this.entryRepository.findAll({
            where: { postingDate: { afterOrOn: from, beforeOrOn: until } },
            order: { postingDate: 'ASC', sequence: 'ASC' },
            limit: 'all'
        });
        const lines: Map<string, JournalEntryLine[]> = new Map(entries.map(entry => [entry.id, []]));
        if (entries.length) {
            // by the fiscal years rather than the ids of the entries, of which a year has more than a query takes
            const fiscalYearIds: string[] = [...new Set(entries.map(entry => entry.fiscalYearId))];
            for await (const line of this.lineRepository.stream({ where: { fiscalYearId: { oneOf: fiscalYearIds } }, order: { chainSequence: 'ASC' } })) {
                lines.get(line.entryId)?.push(line);
            }
        }
        const reversedBy: Map<string, string> = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE)
            .resolveReversingEntryIds(entries.map(entry => entry.id));
        const details: JournalEntryDetails[] = entries.map(entry => ({
            entry,
            lines: lines.get(entry.id) ?? [],
            reversedByEntryId: reversedBy.get(entry.id) ?? null
        }));
        const all: JournalEntryLine[] = details.flatMap(d => d.lines);
        return {
            from,
            until,
            entries: details,
            debit: JournalEntryUtilities.resolveDebitTotal(all),
            credit: JournalEntryUtilities.resolveCreditTotal(all)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveLedger(accountId: string, from: Date, until: Date): Promise<BookkeepingLedgerReport> {
        this.validateRange(from, until);
        const account: BookkeepingAccount = await this.accountRepository.findById(accountId);
        const fiscalYears: FiscalYear[] = await this.fiscalYearRepository.findAll({
            where: { start: { beforeOrOn: until }, end: { afterOrOn: from } },
            order: { start: 'ASC' },
            limit: 'all'
        });
        const fiscalYearIds: string[] = fiscalYears.map(fiscalYear => fiscalYear.id);
        const opened: FiscalYear | undefined = fiscalYears.find(y => y.start.getTime() <= from.getTime());
        const entries: Map<string, JournalEntry> = new Map();
        const lines: JournalEntryLine[] = [];
        if (fiscalYearIds.length) {
            for await (const entry of this.entryRepository.stream({ where: { fiscalYearId: { oneOf: fiscalYearIds } } })) {
                entries.set(entry.id, entry);
            }
            for await (const line of this.lineRepository.stream({
                where: { accountId, fiscalYearId: { oneOf: fiscalYearIds } },
                order: { chainSequence: 'ASC' }
            })) {
                lines.push(line);
            }
        }
        let openingBalance: BigNumber = new BigNumber(0);
        const booked: [JournalEntry, JournalEntryLine][] = [];
        for (const line of lines) {
            const entry: JournalEntry | undefined = entries.get(line.entryId);
            if (entry == undefined || entry.postingDate.getTime() > until.getTime()) {
                continue;
            }
            if (entry.postingDate.getTime() < from.getTime()) {
                if (entry.fiscalYearId === opened?.id) {
                    openingBalance = NumberUtilities.add(openingBalance, this.resolveNet(line));
                }
                continue;
            }
            booked.push([entry, line]);
        }
        booked.sort(([a], [b]) => a.postingDate.getTime() - b.postingDate.getTime() || a.sequence - b.sequence);

        // the balance runs within each fiscal year, which opens with the balance of the one before as an entry of its
        // own: carried over, it would count twice
        let fiscalYearId: string | undefined = opened?.id;
        let balance: BigNumber = openingBalance;
        const ledgerLines: BookkeepingLedgerLine[] = booked.map(([entry, line]) => {
            if (entry.fiscalYearId !== fiscalYearId) {
                fiscalYearId = entry.fiscalYearId;
                balance = new BigNumber(0);
            }
            balance = NumberUtilities.add(balance, this.resolveNet(line));
            return {
                entryId: entry.id,
                fiscalYearId: entry.fiscalYearId,
                sequence: entry.sequence,
                postingDate: entry.postingDate,
                documentDate: entry.documentDate,
                documentReference: entry.documentReference ?? null,
                text: entry.text,
                debit: line.debit ?? null,
                credit: line.credit ?? null,
                balance
            };
        });
        const bookedLines: JournalEntryLine[] = booked.map(([, line]) => line);
        return {
            account,
            from,
            until,
            openingBalance,
            lines: ledgerLines,
            debit: JournalEntryUtilities.resolveDebitTotal(bookedLines),
            credit: JournalEntryUtilities.resolveCreditTotal(bookedLines),
            closingBalance: balance
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTrialBalance(fiscalYearId: string, until: Date | undefined): Promise<BookkeepingTrialBalance> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        const last: Date = until ?? fiscalYear.end;
        BookkeepingDayUtilities.validateDay(last, 'until');
        if (last.getTime() < fiscalYear.start.getTime() || last.getTime() > fiscalYear.end.getTime()) {
            const [start, end] = this.formatDays(fiscalYear);
            throw new BadRequestError($ts`The until needs to be a day of the fiscal year from ${start} to ${end}.`);
        }
        const balances: BookkeepingAccountBalance[] = await this.resolveBalances(fiscalYear, last);
        const rows: BookkeepingTrialBalanceRow[] = balances.map(b => ({
            account: b.account,
            debit: b.debit,
            credit: b.credit,
            balance: NumberUtilities.subtract(b.debit, b.credit)
        }));
        const sum: (amounts: BigNumber[]) => BigNumber = amounts => amounts.reduce((total, amount) => NumberUtilities.add(total, amount), new BigNumber(0));
        return {
            fiscalYearId: fiscalYear.id,
            start: fiscalYear.start,
            until: last,
            rows,
            debit: sum(rows.map(row => row.debit)),
            credit: sum(rows.map(row => row.credit)),
            debitBalances: sum(rows.filter(row => row.balance.isGreaterThan(0)).map(row => row.balance)),
            creditBalances: sum(rows.filter(row => row.balance.isLessThan(0)).map(row => row.balance.negated()))
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBalanceSheet(fiscalYearId: string, form: string | undefined, transaction?: Transaction): Promise<BookkeepingStatement> {
        return await this.resolveStatement(fiscalYearId, BookkeepingStatementType.BALANCE_SHEET, form, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIncomeStatement(fiscalYearId: string, form: string | undefined, transaction?: Transaction): Promise<BookkeepingStatement> {
        return await this.resolveStatement(fiscalYearId, BookkeepingStatementType.INCOME_STATEMENT, form, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveStatementForms(fiscalYearId: string): Promise<BookkeepingStatementForms> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        if (fiscalYear.closedAt != undefined) {
            const [balanceSheet, incomeStatement] = await Promise.all([
                this.findArchivedStatement(fiscalYear, BookkeepingStatementType.BALANCE_SHEET, undefined),
                this.findArchivedStatement(fiscalYear, BookkeepingStatementType.INCOME_STATEMENT, undefined)
            ]);
            if (balanceSheet != undefined && incomeStatement != undefined) {
                return { balanceSheet: balanceSheet.form, incomeStatement: incomeStatement.form };
            }
        }
        return await this.resolveForms(await this.resolveSettings(), fiscalYear);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveStatementFormChoices(fiscalYearId: string): Promise<BookkeepingStatementFormChoices> {
        const forms: BookkeepingStatementForms = await this.resolveStatementForms(fiscalYearId);
        const translate: (label: TranslationToken) => string = this.resolveTranslate();
        const choiceOf: (type: BookkeepingStatementType, applies: string) => BookkeepingStatementFormChoice = (type, applies) => ({
            applies,
            forms: this.structures.filter(s => s.type === type).map(s => ({ id: s.id, name: translate(s.name ?? s.label) }))
        });
        return {
            fiscalYearId,
            balanceSheet: choiceOf(BookkeepingStatementType.BALANCE_SHEET, forms.balanceSheet),
            incomeStatement: choiceOf(BookkeepingStatementType.INCOME_STATEMENT, forms.incomeStatement)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRevenue(year: number): Promise<BookkeepingRevenueReport> {
        if (!Number.isInteger(year)) {
            throw new BadRequestError($ts`The year needs to be a whole number, such as 2026.`);
        }
        const from: Date = new Date(Date.UTC(year, 0, 1));
        const until: Date = new Date(Date.UTC(year, 11, 31));
        const included: Set<string> = new Set();
        for await (const entry of this.entryRepository.stream({
            where: { postingDate: { afterOrOn: from, beforeOrOn: until } },
            select: { id: true, sourceType: true }
        })) {
            if (entry.sourceType !== FiscalYearEntrySourceType.CLOSING) {
                included.add(entry.id);
            }
        }
        const fiscalYears: FiscalYear[] = await this.fiscalYearRepository.findAll({
            where: { start: { beforeOrOn: until }, end: { afterOrOn: from } },
            limit: 'all'
        });
        const balances: BookkeepingAccountBalance[] = (await this.resolveSums(fiscalYears.map(y => y.id), included))
            .filter(b => b.account.type === BookkeepingAccountType.REVENUE);
        const accounts: BookkeepingAccountAmount[] = balances.map(b => ({
            accountId: b.account.id,
            number: b.account.number,
            name: b.account.name,
            amount: NumberUtilities.subtract(b.credit, b.debit)
        }));
        return {
            year,
            from,
            until,
            accounts,
            total: accounts.reduce((total, a) => NumberUtilities.add(total, a.amount), new BigNumber(0))
        };
    }

    /**
     * Resolves a statement of a fiscal year in a form.
     * @param fiscalYearId - The id of the fiscal year.
     * @param type - What it states.
     * @param form - The id of the structure, or undefined for the default form of the fiscal year.
     * @param transaction - The transaction to read in, if any.
     * @returns The statement.
     */
    protected async resolveStatement(
        fiscalYearId: string,
        type: BookkeepingStatementType,
        form: string | undefined,
        transaction?: Transaction
    ): Promise<BookkeepingStatement> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId, { transaction });
        if (fiscalYear.closedAt != undefined) {
            const archived: FiscalYearStatement | undefined = await this.findArchivedStatement(fiscalYear, type, form, transaction);
            if (archived != undefined) {
                return archived.statement;
            }
            // a form not archived, rolled up from the full form archived beside the one that applied
            const full: FiscalYearStatement | undefined = form == undefined
                ? undefined
                : await this.findArchivedStatement(fiscalYear, type, this.resolveFullStructure(type).id, transaction);
            if (full != undefined && form != undefined) {
                const structure: BookkeepingStatementStructure = this.resolveNamedStructure(type, form);
                const translate: (label: TranslationToken) => string = this.resolveTranslate();
                const positions: BookkeepingStatementPosition[] = BookkeepingStatementUtilities.resolveFormPositions(
                    structure,
                    full.statement.positions,
                    translate
                );
                const previous: BookkeepingStatementPosition[] | undefined = await this.resolvePreviousPositions(
                    fiscalYear,
                    structure,
                    type,
                    translate,
                    transaction
                );
                return {
                    ...full.statement,
                    form: structure.id,
                    label: translate(structure.label),
                    positions: BookkeepingStatementUtilities.resolvePreviousAmounts(positions, previous)
                };
            }
        }
        const structure: BookkeepingStatementStructure = await this.resolveStructure(
            await this.resolveSettings(transaction),
            fiscalYear,
            type,
            form,
            transaction
        );
        return await this.computeStatement(fiscalYear, structure, type, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async archiveStatements(fiscalYear: FiscalYear, transaction: Transaction): Promise<FiscalYearStatement[]> {
        // everything read in the transaction of the closing, which sees what it wrote before, such as a proposal posted
        const forms: BookkeepingStatementForms = await this.resolveForms(await this.resolveSettings(transaction), fiscalYear, transaction);
        const retainUntil: Date = ArchiveUtilities.resolveRetainUntil(
            fiscalYear.end,
            { retention: inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS).retention, from: 'endOfYear' },
            inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
        );
        const [start, end] = this.formatDays(fiscalYear);
        const res: FiscalYearStatement[] = [];
        for (const type of [BookkeepingStatementType.BALANCE_SHEET, BookkeepingStatementType.INCOME_STATEMENT]) {
            const applying: BookkeepingStatementStructure = this.resolveNamedStructure(
                type,
                type === BookkeepingStatementType.BALANCE_SHEET ? forms.balanceSheet : forms.incomeStatement
            );
            const full: BookkeepingStatementStructure = this.resolveFullStructure(type);
            // the full form as well, which every other form rolls up from and the year after takes its figures from
            for (const structure of applying.id === full.id ? [applying] : [applying, full]) {
                const statement: BookkeepingStatement = await this.computeStatement(fiscalYear, structure, type, transaction);
                const pdf: Readable = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE).resolveStatementDocument(statement, transaction);
                const record: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store(
                    {
                        store: inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.RECEIPT_FILE_STORE),
                        name: `${structure.id}-${start}-${end}.pdf`,
                        mimeType: MimeType.PDF,
                        data: await buffer(pdf)
                    },
                    transaction
                );
                res.push(await this.statementRepository.create(
                    {
                        fiscalYearId: fiscalYear.id,
                        end: fiscalYear.end,
                        // a year reopened and closed again archives its statements beside those of before
                        closing: fiscalYear.reopenings + 1,
                        type,
                        form: structure.id,
                        applies: structure === applying,
                        statement,
                        file: record.id,
                        archivedAt: new Date(),
                        retainUntil
                    },
                    { transaction }
                ));
            }
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findArchivedStatement(
        fiscalYear: FiscalYear,
        type: BookkeepingStatementType,
        form: string | undefined,
        transaction?: Transaction
    ): Promise<FiscalYearStatement | undefined> {
        // those of the latest closing: a reopening keeps those of the closings before it, which no longer count
        const closing: number = fiscalYear.reopenings + 1;
        return await this.statementRepository.findOne({
            where: form == undefined ? { fiscalYearId: fiscalYear.id, closing, type, applies: true } : { fiscalYearId: fiscalYear.id, closing, type, form },
            required: false,
            transaction
        });
    }

    /**
     * Resolves a statement of a fiscal year in a form from its balances, with the figures of the year before.
     * @param fiscalYear - The fiscal year.
     * @param structure - The structure of the form.
     * @param type - What it states.
     * @param transaction - The transaction to read in, if any.
     * @returns The statement.
     */
    protected async computeStatement(
        fiscalYear: FiscalYear,
        structure: BookkeepingStatementStructure,
        type: BookkeepingStatementType,
        transaction?: Transaction
    ): Promise<BookkeepingStatement> {
        const balances: BookkeepingAccountBalance[] = await this.resolveBalances(fiscalYear, undefined, transaction);
        const result: BigNumber = BookkeepingStatementUtilities.resolveResult(balances);
        const translate: (label: TranslationToken) => string = this.resolveTranslate();
        const { positions, unmapped } = BookkeepingStatementUtilities.resolveStatement(structure, this.structures, balances, result, translate);
        const previousYear: FiscalYear | undefined = await this.findPreviousFiscalYear(fiscalYear, transaction);
        const previous: BookkeepingStatementPosition[] | undefined = await this.resolvePreviousPositions(fiscalYear, structure, type, translate, transaction);
        return {
            fiscalYearId: fiscalYear.id,
            start: fiscalYear.start,
            end: fiscalYear.end,
            previousFiscalYearId: previousYear?.id ?? null,
            previousEnd: previousYear?.end ?? null,
            closed: fiscalYear.closedAt != undefined,
            type,
            form: structure.id,
            label: translate(structure.label),
            positions: BookkeepingStatementUtilities.resolvePreviousAmounts(positions, previous),
            unmapped,
            result
        };
    }

    /**
     * Resolves the positions of a form in the fiscal year before one, from the full statement archived at its closing,
     * or from its balances while it is open.
     * @param fiscalYear - The fiscal year.
     * @param structure - The structure of the form.
     * @param type - What it states.
     * @param translate - Translates a label.
     * @param transaction - The transaction to read in, if any.
     * @returns The positions, or undefined for the first fiscal year of the books.
     */
    protected async resolvePreviousPositions(
        fiscalYear: FiscalYear,
        structure: BookkeepingStatementStructure,
        type: BookkeepingStatementType,
        translate: (label: TranslationToken) => string,
        transaction?: Transaction
    ): Promise<BookkeepingStatementPosition[] | undefined> {
        const previousYear: FiscalYear | undefined = await this.findPreviousFiscalYear(fiscalYear, transaction);
        if (previousYear == undefined) {
            return undefined;
        }
        const full: BookkeepingStatementStructure = this.resolveFullStructure(type);
        const archived: FiscalYearStatement | undefined = previousYear.closedAt == undefined
            ? undefined
            : await this.findArchivedStatement(previousYear, type, full.id, transaction);
        let fullPositions: BookkeepingStatementPosition[];
        if (archived == undefined) {
            const balances: BookkeepingAccountBalance[] = await this.resolveBalances(previousYear, undefined, transaction);
            fullPositions = BookkeepingStatementUtilities.resolveStatement(
                full,
                this.structures,
                balances,
                BookkeepingStatementUtilities.resolveResult(balances),
                translate
            ).positions;
        }
        else {
            fullPositions = archived.statement.positions;
        }
        return BookkeepingStatementUtilities.resolveFormPositions(structure, fullPositions, translate);
    }

    /**
     * Finds the fiscal year before one: the one ending the day before it starts.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction to read in, if any.
     * @returns The fiscal year before, or undefined for the first of the books.
     */
    protected async findPreviousFiscalYear(fiscalYear: FiscalYear, transaction?: Transaction): Promise<FiscalYear | undefined> {
        return await this.fiscalYearRepository.findOne({
            where: { end: BookkeepingDayUtilities.resolvePreviousDay(fiscalYear.start) },
            required: false,
            transaction
        });
    }

    /**
     * Resolves a structure by its id.
     * @param type - What it states.
     * @param form - The id of the structure.
     * @returns The structure.
     * @throws A BadRequestError for a form that is not a structure of the type.
     */
    protected resolveNamedStructure(type: BookkeepingStatementType, form: string): BookkeepingStatementStructure {
        const named: BookkeepingStatementStructure | undefined = this.structures.find(s => s.id === form && s.type === type);
        if (named == undefined) {
            throw new BadRequestError(
                $ts`The form "${form}" needs to be a statement structure of the type ${type} in ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES.`
            );
        }
        return named;
    }

    /**
     * Resolves how the labels of a report are translated: in the locale of the request, or the default.
     * @returns The translation of a label.
     */
    protected resolveTranslate(): (label: TranslationToken) => string {
        const locale: LocaleCode = this.resolveLocale();
        return label => label.getValue(locale);
    }

    /**
     * Resolves the structure of a statement: the form named, or the default form of the fiscal year.
     * @param settings - The settings of the books.
     * @param fiscalYear - The fiscal year.
     * @param type - What the statement states.
     * @param form - The id of the structure, if any.
     * @param transaction - The transaction to read in, if any.
     * @returns The structure.
     * @throws A BadRequestError for a form that is not a structure of the type.
     */
    protected async resolveStructure(
        settings: BookkeepingSettings,
        fiscalYear: FiscalYear,
        type: BookkeepingStatementType,
        form: string | undefined,
        transaction?: Transaction
    ): Promise<BookkeepingStatementStructure> {
        if (form != undefined) {
            return this.resolveNamedStructure(type, form);
        }
        const forms: BookkeepingStatementForms = await this.resolveForms(settings, fiscalYear, transaction);
        return this.resolveNamedStructure(type, type === BookkeepingStatementType.BALANCE_SHEET ? forms.balanceSheet : forms.incomeStatement);
    }

    /**
     * Resolves the forms of the statements of a fiscal year: those of the first conformance answering, or else the
     * full structures.
     * @param settings - The settings of the books.
     * @param fiscalYear - The fiscal year.
     * @param transaction - The transaction the conformances read in, if any.
     * @returns The ids of the structures.
     */
    protected async resolveForms(settings: BookkeepingSettings, fiscalYear: FiscalYear, transaction?: Transaction): Promise<BookkeepingStatementForms> {
        const conformances: BookkeepingConformanceServiceInterface[] = BookkeepingConformanceUtilities.resolveConformances(
            this.conformanceServices,
            settings,
            fiscalYear
        );
        // one after the other: the first answering decides
        for (const conformance of conformances) {
            const forms: BookkeepingStatementForms | undefined = await conformance.resolveStatementForms?.({
                settings,
                fiscalYear,
                legalForm: BookkeepingConformanceUtilities.findLegalForm(settings, fiscalYear.end),
                transaction
            });
            if (forms != undefined) {
                return forms;
            }
        }
        return {
            balanceSheet: this.resolveFullStructure(BookkeepingStatementType.BALANCE_SHEET).id,
            incomeStatement: this.resolveFullStructure(BookkeepingStatementType.INCOME_STATEMENT).id
        };
    }

    /**
     * Resolves the first full structure of a type.
     * @param type - The type.
     * @returns The structure.
     * @throws An InternalError when none is registered.
     */
    protected resolveFullStructure(type: BookkeepingStatementType): BookkeepingStatementStructure {
        const res: BookkeepingStatementStructure | undefined = this.structures.find(s => s.type === type && s.rollsUpFrom == undefined);
        if (res == undefined) {
            throw new InternalError(`ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES needs a full structure of the type ${type}.`);
        }
        return res;
    }

    /**
     * Resolves what the lines of a fiscal year add up to on each account, up to a day, leaving out the entry closing
     * it.
     * @param fiscalYear - The fiscal year.
     * @param until - The last day whose entries count, or undefined for every day.
     * @param transaction - The transaction to read in, if any.
     * @returns The balances, by the number of their account.
     */
    protected async resolveBalances(fiscalYear: FiscalYear, until: Date | undefined, transaction?: Transaction): Promise<BookkeepingAccountBalance[]> {
        const included: Set<string> = new Set();
        for await (const entry of this.entryRepository.stream({
            where: until == undefined ? { fiscalYearId: fiscalYear.id } : { fiscalYearId: fiscalYear.id, postingDate: { beforeOrOn: until } },
            select: { id: true, sourceType: true },
            transaction
        })) {
            if (entry.sourceType !== FiscalYearEntrySourceType.CLOSING) {
                included.add(entry.id);
            }
        }
        return await this.resolveSums([fiscalYear.id], included, transaction);
    }

    /**
     * Resolves what the lines of entries add up to on each account.
     * @param fiscalYearIds - The fiscal years of the entries.
     * @param entryIds - The ids of the entries.
     * @param transaction - The transaction to read in, if any.
     * @returns The balances, by the number of their account.
     */
    protected async resolveSums(fiscalYearIds: string[], entryIds: Set<string>, transaction?: Transaction): Promise<BookkeepingAccountBalance[]> {
        const sums: Map<string, Sums> = new Map();
        if (!entryIds.size || !fiscalYearIds.length) {
            return [];
        }
        for await (const line of this.lineRepository.stream({
            where: { fiscalYearId: { oneOf: fiscalYearIds } },
            select: { entryId: true, accountId: true, debit: true, credit: true },
            transaction
        })) {
            if (!entryIds.has(line.entryId)) {
                continue;
            }
            const sum: Sums = sums.get(line.accountId) ?? { debit: new BigNumber(0), credit: new BigNumber(0) };
            sums.set(line.accountId, {
                debit: line.debit == undefined ? sum.debit : NumberUtilities.add(sum.debit, line.debit),
                credit: line.credit == undefined ? sum.credit : NumberUtilities.add(sum.credit, line.credit)
            });
        }
        if (!sums.size) {
            return [];
        }
        const accounts: BookkeepingAccount[] = await this.accountRepository.findAll({ where: { id: { oneOf: [...sums.keys()] } }, limit: 'all', transaction });
        return JournalEntryUtilities.sortBalances(accounts.map(account => ({
            account,
            debit: sums.get(account.id)?.debit ?? new BigNumber(0),
            credit: sums.get(account.id)?.credit ?? new BigNumber(0)
        })));
    }

    /**
     * Resolves the settings of the books of the current tenant.
     * @param transaction - The transaction to read in, if any.
     * @returns The settings.
     * @throws A ConflictError for a tenant that keeps no books.
     */
    protected async resolveSettings(transaction?: Transaction): Promise<BookkeepingSettings> {
        const settings: BookkeepingSettings | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).findSettings(transaction);
        if (settings == undefined) {
            throw new ConflictError($ts`The books of the tenant need settings, with the currency they are kept in, before they are kept.`);
        }
        return settings;
    }

    /**
     * Resolves the locale the labels of a report are in: the one of the request, or the default.
     * @returns The locale.
     */
    protected resolveLocale(): LocaleCode {
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT));
    }

    /**
     * Validates the days of a range.
     * @param from - The first day.
     * @param until - The last day.
     * @throws A BadRequestError for a day with a time, or an `until` before `from`.
     */
    protected validateRange(from: Date, until: Date): void {
        BookkeepingDayUtilities.validateDay(from, 'from');
        BookkeepingDayUtilities.validateDay(until, 'until');
        if (until.getTime() < from.getTime()) {
            throw new BadRequestError($ts`The until needs to be on or after the from, ${BookkeepingDayUtilities.formatDay(from)}.`);
        }
    }

    /**
     * Resolves the debit less the credit of a line.
     * @param line - The line.
     * @returns The amount, below 0 for a credit.
     */
    protected resolveNet(line: Pick<JournalEntryLine, 'debit' | 'credit'>): BigNumber {
        return NumberUtilities.subtract(line.debit ?? 0, line.credit ?? 0);
    }

    /**
     * Formats the first and the last day of a fiscal year.
     * @param fiscalYear - The fiscal year.
     * @returns The days.
     */
    protected formatDays(fiscalYear: Pick<FiscalYear, 'start' | 'end'>): [string, string] {
        return [BookkeepingDayUtilities.formatDay(fiscalYear.start), BookkeepingDayUtilities.formatDay(fiscalYear.end)];
    }
}
