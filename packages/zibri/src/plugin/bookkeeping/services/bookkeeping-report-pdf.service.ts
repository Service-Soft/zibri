import { type Readable } from 'node:stream';

import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type PdfContentDefinition,
    type PdfContentSize,
    type PdfDocument,
    type PdfDocumentDefinition,
    type PdfTableCellDefinition,
    PdfUtilities } from '../../../document/pdf.utilities';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { type LocalizeServiceInterface } from '../../../localization/localize-service.interface';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { type LocaleCode } from '../../../localization/models/locale-code.model';
import { $ts } from '../../../localization/translate.function';
import { type BigNumber } from '../../../utilities/number.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { type BookkeepingAccountAmount } from '../models/bookkeeping-account-amount.model';
import { BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingCompany } from '../models/bookkeeping-company.model';
import { type BookkeepingJournalReport } from '../models/bookkeeping-journal-report.model';
import { type BookkeepingLedgerReport } from '../models/bookkeeping-ledger-report.model';
import { type BookkeepingReportContext } from '../models/bookkeeping-report-context.model';
import { type BookkeepingRevenueReport } from '../models/bookkeeping-revenue-report.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { type BookkeepingStatementPosition } from '../models/bookkeeping-statement-position.model';
import { BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';
import { type BookkeepingTrialBalance } from '../models/bookkeeping-trial-balance.model';
import { type FiscalYearStatement } from '../models/fiscal-year-statement.model';
import { FiscalYear } from '../models/fiscal-year.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { type BookkeepingReportPdfServiceInterface } from './bookkeeping-report-pdf-service.interface';
import { type BookkeepingReportServiceInterface } from './bookkeeping-report-service.interface';
import { BookkeepingConformanceUtilities } from './conformance/bookkeeping-conformance.utilities';

/**
 * How amounts and days of a report are written, and whose books they are.
 */
type ReportFormat = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    locale: LocaleCode,
    /**
     * The currency of the books.
     */
    currency: CurrencyCode,
    /**
     * The company whose books they are, or null for none.
     */
    company: BookkeepingCompany | null
};

/**
 * The cell of an amount in a table of a report.
 */
type AmountCell = {
    /**
     * The amount as it is written, or an empty string for none.
     */
    text: string,
    /**
     * Where the amount is aligned.
     */
    alignment: 'right'
};

/**
 * Default implementation of the report pdf service: the company, a title, the period, and a table per report.
 */
@Injectable({ register: 'onUse' })
export class BookkeepingReportPdfService implements BookkeepingReportPdfServiceInterface {
    private get reportService(): BookkeepingReportServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
    }

    private get localizeService(): LocalizeServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveJournalPdf(from: Date, until: Date): Promise<Readable> {
        const report: BookkeepingJournalReport = await this.reportService.resolveJournal(from, until);
        const accounts: BookkeepingAccount[] = await this.accountRepository.findAll({ limit: 'all' });
        return await this.resolvePdf(this.resolveJournalDefinition(report, accounts, await this.resolveFormat()));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveLedgerPdf(accountId: string, from: Date, until: Date): Promise<Readable> {
        const report: BookkeepingLedgerReport = await this.reportService.resolveLedger(accountId, from, until);
        return await this.resolvePdf(this.resolveLedgerDefinition(report, await this.resolveFormat()));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTrialBalancePdf(fiscalYearId: string, until: Date | undefined): Promise<Readable> {
        const report: BookkeepingTrialBalance = await this.reportService.resolveTrialBalance(fiscalYearId, until);
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        return await this.resolvePdf(this.resolveTrialBalanceDefinition(report, fiscalYear, await this.resolveFormat()));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBalanceSheetPdf(fiscalYearId: string, form: string | undefined): Promise<Readable> {
        return await this.resolveStatementPdf(fiscalYearId, BookkeepingStatementType.BALANCE_SHEET, form);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIncomeStatementPdf(fiscalYearId: string, form: string | undefined): Promise<Readable> {
        return await this.resolveStatementPdf(fiscalYearId, BookkeepingStatementType.INCOME_STATEMENT, form);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRevenuePdf(year: number): Promise<Readable> {
        const report: BookkeepingRevenueReport = await this.reportService.resolveRevenue(year);
        return await this.resolvePdf(this.resolveRevenueDefinition(report, await this.resolveFormat()));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveStatementDocument(statement: BookkeepingStatement, transaction?: Transaction): Promise<Readable> {
        const settings: BookkeepingSettings = await this.resolveSettings(transaction);
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(statement.fiscalYearId, { transaction });
        const definition: PdfDocumentDefinition = this.resolveStatementDefinition(
            statement,
            { locale: this.resolveLocale(), currency: settings.currency, company: settings.company ?? null }
        );
        const context: BookkeepingReportContext = {
            settings,
            fiscalYear,
            legalForm: BookkeepingConformanceUtilities.findLegalForm(settings, fiscalYear.end),
            transaction
        };
        // one after the other, each on what the one before left
        for (const conformance of BookkeepingConformanceUtilities.resolveConformances(
            inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES),
            settings,
            fiscalYear
        )) {
            await conformance.updateReportDefinition?.(statement, definition, context);
        }
        return await this.resolvePdf(definition);
    }

    /**
     * Resolves the pdf of a statement: the one archived at the closing of its fiscal year, or else rendered.
     * @param fiscalYearId - The id of the fiscal year.
     * @param type - What it states.
     * @param form - The id of the form, or undefined for the default one.
     * @returns The pdf.
     */
    protected async resolveStatementPdf(fiscalYearId: string, type: BookkeepingStatementType, form: string | undefined): Promise<Readable> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        const archived: FiscalYearStatement | undefined = fiscalYear.closedAt == undefined
            ? undefined
            : await this.reportService.findArchivedStatement(fiscalYear, type, form);
        if (archived != undefined) {
            // read through the archive, which falls back to its copies when the bytes do not match
            return await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(archived, archived.file);
        }
        const statement: BookkeepingStatement = type === BookkeepingStatementType.BALANCE_SHEET
            ? await this.reportService.resolveBalanceSheet(fiscalYearId, form)
            : await this.reportService.resolveIncomeStatement(fiscalYearId, form);
        return await this.resolveStatementDocument(statement);
    }

    /**
     * Resolves the definition of the pdf of a journal.
     * @param report - The journal.
     * @param accounts - The accounts of the books.
     * @param format - How amounts and days are written.
     * @returns The definition.
     */
    protected resolveJournalDefinition(
        report: BookkeepingJournalReport,
        accounts: BookkeepingAccount[],
        format: ReportFormat
    ): PdfDocumentDefinition {
        const byId: Map<string, BookkeepingAccount> = new Map(accounts.map(account => [account.id, account]));
        const headers: string[] = [$ts`Date`, $ts`No.`, $ts`Document`, $ts`Text`, $ts`Account`, $ts`Debit`, $ts`Credit`];
        const body: PdfTableCellDefinition[][] = [this.resolveHeader(headers, 5)];
        for (const entryWithLines of report.entries) {
            body.push(...this.resolveJournalRows(entryWithLines, byId, format));
        }
        body.push(this.resolveTotalRow([$ts`Total`, '', '', '', ''], [report.debit, report.credit], format));
        return this.resolveDefinition(
            $ts`Journal`,
            this.resolveRange(report.from, report.until, format),
            this.resolveTable([60, 30, 60, '*', 100, 65, 65], body),
            format
        );
    }

    /**
     * Resolves the rows of an entry in the pdf of a journal: a row per line, with the day, number, document and text
     * of the entry in its first row only.
     * @param details - The entry and its lines.
     * @param byId - The accounts of the books, by their id.
     * @param format - How amounts and days are written.
     * @returns The rows.
     */
    protected resolveJournalRows(
        details: JournalEntryDetails,
        byId: Map<string, BookkeepingAccount>,
        format: ReportFormat
    ): PdfTableCellDefinition[][] {
        const { entry, lines } = details;
        return lines.map((line, index) => {
            const account: BookkeepingAccount | undefined = byId.get(line.accountId);
            return [
                index ? '' : this.formatDay(entry.postingDate, format),
                index ? '' : String(entry.sequence),
                index ? '' : entry.documentReference ?? '',
                index ? '' : entry.text,
                account == undefined ? line.accountId : `${account.number} ${account.name}`,
                this.resolveAmountCell(line.debit ?? undefined, format),
                this.resolveAmountCell(line.credit ?? undefined, format)
            ];
        });
    }

    /**
     * Resolves the definition of the pdf of a ledger.
     * @param report - The ledger.
     * @param format - How amounts and days are written.
     * @returns The definition.
     */
    protected resolveLedgerDefinition(report: BookkeepingLedgerReport, format: ReportFormat): PdfDocumentDefinition {
        const body: PdfTableCellDefinition[][] = [
            this.resolveHeader([$ts`Date`, $ts`No.`, $ts`Document`, $ts`Text`, $ts`Debit`, $ts`Credit`, $ts`Balance`], 4),
            ['', '', '', $ts`Opening balance`, '', '', this.resolveAmountCell(report.openingBalance, format)]
        ];
        for (const line of report.lines) {
            body.push([
                this.formatDay(line.postingDate, format),
                String(line.sequence),
                line.documentReference ?? '',
                line.text,
                this.resolveAmountCell(line.debit ?? undefined, format),
                this.resolveAmountCell(line.credit ?? undefined, format),
                this.resolveAmountCell(line.balance, format)
            ]);
        }
        body.push(this.resolveTotalRow([$ts`Total`, '', '', ''], [report.debit, report.credit, report.closingBalance], format));
        const account: string = `${report.account.number} ${report.account.name}`;
        return this.resolveDefinition(
            $ts`Ledger of the account ${account}`,
            this.resolveRange(report.from, report.until, format),
            this.resolveTable([60, 30, 60, '*', 65, 65, 70], body),
            format
        );
    }

    /**
     * Resolves the definition of the pdf of a trial balance.
     * @param report - The trial balance.
     * @param fiscalYear - Its fiscal year.
     * @param format - How amounts and days are written.
     * @returns The definition.
     */
    protected resolveTrialBalanceDefinition(
        report: BookkeepingTrialBalance,
        fiscalYear: FiscalYear,
        format: ReportFormat
    ): PdfDocumentDefinition {
        const headers: string[] = [$ts`Account`, $ts`Name`, $ts`Debit`, $ts`Credit`, $ts`Debit balance`, $ts`Credit balance`];
        const body: PdfTableCellDefinition[][] = [this.resolveHeader(headers, 2)];
        for (const row of report.rows) {
            body.push([
                row.account.number,
                row.account.name,
                this.resolveAmountCell(row.debit, format),
                this.resolveAmountCell(row.credit, format),
                this.resolveAmountCell(row.balance.isGreaterThan(0) ? row.balance : undefined, format),
                this.resolveAmountCell(row.balance.isLessThan(0) ? row.balance.negated() : undefined, format)
            ]);
        }
        body.push(this.resolveTotalRow(
            [$ts`Total`, ''],
            [report.debit, report.credit, report.debitBalances, report.creditBalances],
            format
        ));
        const start: string = this.formatDay(fiscalYear.start, format);
        const end: string = this.formatDay(fiscalYear.end, format);
        return this.resolveDefinition(
            $ts`Trial balance of the fiscal year from ${start} to ${end}`,
            $ts`Entries up to ${this.formatDay(report.until, format)}`,
            this.resolveTable([45, '*', 70, 70, 70, 70], body),
            format
        );
    }

    /**
     * Resolves the definition of the pdf of a statement: each position with its number, its amount and the amount of
     * the year before, indented by its depth, and the accounts without a position below them. The column of the year
     * before is empty for the first fiscal year of the books.
     * @param statement - The statement.
     * @param format - How amounts and days are written.
     * @returns The definition.
     */
    protected resolveStatementDefinition(statement: BookkeepingStatement, format: ReportFormat): PdfDocumentDefinition {
        const end: string = this.formatDay(statement.end, format);
        const start: string = this.formatDay(statement.start, format);
        const body: PdfTableCellDefinition[][] = [
            this.resolveHeader(['', end, statement.previousEnd == undefined ? '' : this.formatDay(statement.previousEnd, format)], 1),
            ...statement.positions.map(position => [
                {
                    text: `${this.resolvePositionNumber(position)}${position.label}`,
                    bold: position.depth === 0,
                    margin: [position.depth * 10, 0, 0, 0]
                },
                { ...this.resolveAmountCell(position.amount, format), bold: position.depth === 0 },
                { ...this.resolveAmountCell(position.previousAmount ?? undefined, format), bold: position.depth === 0 }
            ] satisfies PdfTableCellDefinition[])
        ];
        const title: string = statement.type === BookkeepingStatementType.BALANCE_SHEET
            ? $ts`${statement.label} as of ${end}`
            : $ts`${statement.label} for the fiscal year from ${start} to ${end}`;
        const content: PdfContentDefinition[] = [this.resolveTable(['*', 85, 85], body)];
        if (statement.unmapped.length) {
            content.push(
                { text: $ts`Accounts without a position`, bold: true, margin: [0, 15, 0, 5] },
                this.resolveTable([45, '*', 90], statement.unmapped.map(a => this.resolveAccountRow(a, format)))
            );
        }
        return this.resolveDefinition(title, undefined, content, format);
    }

    /**
     * Resolves the definition of the pdf of the revenue of a year.
     * @param report - The revenue.
     * @param format - How amounts and days are written.
     * @returns The definition.
     */
    protected resolveRevenueDefinition(report: BookkeepingRevenueReport, format: ReportFormat): PdfDocumentDefinition {
        const body: PdfTableCellDefinition[][] = [
            this.resolveHeader([$ts`Account`, $ts`Name`, $ts`Amount`], 2),
            ...report.accounts.map(a => this.resolveAccountRow(a, format)),
            this.resolveTotalRow([$ts`Total`, ''], [report.total], format)
        ];
        return this.resolveDefinition(
            $ts`Revenue of ${report.year}`,
            this.resolveRange(report.from, report.until, format),
            this.resolveTable([45, '*', 90], body),
            format
        );
    }

    /**
     * Resolves the number a position is written with: the last part of its id, such as `II.` of `assets.B.II`, and
     * none for a position whose id has one part.
     * @param position - The position.
     * @returns The number with a space after it, or an empty string.
     */
    protected resolvePositionNumber(position: BookkeepingStatementPosition): string {
        const parts: string[] = position.id.split('.');
        return parts.length > 1 ? `${parts.at(-1)}. ` : '';
    }

    /**
     * Resolves the definition of a report: the company whose books they are, the title, the line below it, and the
     * tables.
     * @param title - The title.
     * @param subtitle - The line below it, if any.
     * @param content - The tables.
     * @param format - Whose books they are.
     * @returns The definition.
     */
    protected resolveDefinition(
        title: string,
        subtitle: string | undefined,
        content: PdfContentDefinition | PdfContentDefinition[],
        format: ReportFormat
    ): PdfDocumentDefinition {
        const company: PdfContentDefinition[] = format.company == undefined
            ? []
            : [
                {
                    text: [
                        [format.company.name, format.company.seat].filter(part => part != undefined && part !== '').join(', '),
                        [format.company.registerCourt, format.company.registerNumber]
                            .filter(part => part != undefined && part !== '')
                            .join(', ')
                    ].filter(line => line !== '').join('\n'),
                    margin: [0, 0, 0, 10]
                }
            ];
        const heading: PdfContentDefinition = { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, subtitle == undefined ? 12 : 4] };
        const below: PdfContentDefinition[] = subtitle == undefined ? [] : [{ text: subtitle, margin: [0, 0, 0, 12] }];
        return {
            info: { title },
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 40],
            defaultStyle: { fontSize: 9 },
            attachments: [],
            content: [...company, heading, ...below, ...Array.isArray(content) ? content : [content]],
            footer: (currentPage: number, pageCount: number) => ({
                text: `${currentPage} / ${pageCount}`,
                alignment: 'right',
                margin: [40, 10]
            })
        };
    }

    /**
     * Resolves a finished pdf of a definition.
     * @param definition - The definition.
     * @returns The pdf, ended.
     */
    protected async resolvePdf(definition: PdfDocumentDefinition): Promise<Readable> {
        const doc: PdfDocument = await PdfUtilities.resolve(definition);
        doc.end();
        return doc;
    }

    /**
     * Resolves a table.
     * @param widths - The widths of its columns.
     * @param body - Its rows.
     * @returns The table.
     */
    protected resolveTable(widths: PdfContentSize[], body: PdfTableCellDefinition[][]): PdfContentDefinition {
        return { table: { headerRows: 1, widths, body }, layout: 'lightHorizontalLines' };
    }

    /**
     * Resolves the row of the headers of a table.
     * @param headers - The headers.
     * @param firstAmount - The index of the first column of amounts, which are aligned right.
     * @returns The row.
     */
    protected resolveHeader(headers: string[], firstAmount: number): PdfTableCellDefinition[] {
        return headers.map((text, index) => ({ text, bold: true, alignment: index >= firstAmount ? 'right' : 'left' }));
    }

    /**
     * Resolves the row of the totals of a table.
     * @param labels - The cells before the totals.
     * @param totals - The totals.
     * @param format - How amounts are written.
     * @returns The row.
     */
    protected resolveTotalRow(labels: string[], totals: BigNumber[], format: ReportFormat): PdfTableCellDefinition[] {
        return [
            ...labels.map(text => ({ text, bold: true })),
            ...totals.map(total => ({ ...this.resolveAmountCell(total, format), bold: true }))
        ];
    }

    /**
     * Resolves the row of an account and its amount.
     * @param amount - What the account adds.
     * @param format - How amounts are written.
     * @returns The row.
     */
    protected resolveAccountRow(amount: BookkeepingAccountAmount, format: ReportFormat): PdfTableCellDefinition[] {
        return [amount.number, amount.name, this.resolveAmountCell(amount.amount, format)];
    }

    /**
     * Resolves the cell of an amount, aligned right.
     * @param amount - The amount, or undefined for an empty cell.
     * @param format - How amounts are written.
     * @returns The cell.
     */
    protected resolveAmountCell(amount: BigNumber | undefined, format: ReportFormat): AmountCell {
        return {
            text: amount == undefined ? '' : this.localizeService.formatPrice(amount, { currency: format.currency, locale: format.locale }),
            alignment: 'right'
        };
    }

    /**
     * Resolves the line of the days of a range, such as `From 01/01/2026 to 12/31/2026`.
     * @param from - The first day.
     * @param until - The last day.
     * @param format - How days are written.
     * @returns The line.
     */
    protected resolveRange(from: Date, until: Date, format: ReportFormat): string {
        return $ts`From ${this.formatDay(from, format)} to ${this.formatDay(until, format)}`;
    }

    /**
     * Formats a day of the books, which is held as its midnight UTC.
     * @param day - The day.
     * @param format - The locale.
     * @returns The day, such as `12/31/2026`.
     */
    protected formatDay(day: Date, format: ReportFormat): string {
        return this.localizeService.formatDate(day, 'date', { locale: format.locale, timezone: 'UTC' });
    }

    /**
     * Resolves how the amounts and days of a report are written: in the locale of the request and the currency of the
     * books, with the company of the books.
     * @returns The format.
     */
    protected async resolveFormat(): Promise<ReportFormat> {
        const settings: BookkeepingSettings = await this.resolveSettings();
        return { locale: this.resolveLocale(), currency: settings.currency, company: settings.company ?? null };
    }

    /**
     * Resolves the locale of the request, or the default.
     * @returns The locale.
     */
    protected resolveLocale(): LocaleCode {
        return this.localizeService.resolveSupportedLocale(inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT));
    }

    /**
     * Resolves the settings of the books of the current tenant.
     * @param transaction - The transaction to read in, if any.
     * @returns The settings.
     * @throws A ConflictError for a tenant that keeps no books.
     */
    protected async resolveSettings(transaction?: Transaction): Promise<BookkeepingSettings> {
        const settings: BookkeepingSettings | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE)
            .findSettings(transaction);
        if (settings == undefined) {
            throw new ConflictError($ts`The books of the tenant need settings, with the currency they are kept in, before they are kept.`);
        }
        return settings;
    }
}