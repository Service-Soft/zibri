import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingJournalReport } from '../models/bookkeeping-journal-report.model';
import { type BookkeepingLedgerReport } from '../models/bookkeeping-ledger-report.model';
import { type BookkeepingRevenueReport } from '../models/bookkeeping-revenue-report.model';
import { type BookkeepingStatementFormChoices } from '../models/bookkeeping-statement-form-choices.model';
import { type BookkeepingStatementForms } from '../models/bookkeeping-statement-forms.model';
import { type BookkeepingStatementType } from '../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';
import { type BookkeepingTrialBalance } from '../models/bookkeeping-trial-balance.model';
import { type FiscalYearStatement } from '../models/fiscal-year-statement.model';
import { type FiscalYear } from '../models/fiscal-year.model';

/**
 * Answers what the books of the current tenant hold: the journal, the ledger of an account, the trial balance, the
 * balance sheet and the income statement of a fiscal year, and the revenue of a year. A report of a closed fiscal
 * year answers the same every time.
 */
export interface BookkeepingReportServiceInterface {
    /**
     * Resolves the entries posted on the days from `from` to `until`, with their lines.
     * @throws A BadRequestError for a day with a time, or an `until` before `from`.
     */
    resolveJournal: (from: Date, until: Date) => Promise<BookkeepingJournalReport>,
    /**
     * Resolves what was booked on an account on the days from `from` to `until`, with its balance after each line.
     * @throws A NotFoundError for an account the current tenant does not have.
     * @throws A BadRequestError for a day with a time, or an `until` before `from`.
     */
    resolveLedger: (accountId: string, from: Date, until: Date) => Promise<BookkeepingLedgerReport>,
    /**
     * Resolves the sums and balances of every account booked on in a fiscal year, up to and with `until`, its last
     * day by default. The entry closing the year is left out.
     * @throws A BadRequestError for an `until` that is not a day of the fiscal year.
     */
    resolveTrialBalance: (fiscalYearId: string, until: Date | undefined) => Promise<BookkeepingTrialBalance>,
    /**
     * Resolves the balance sheet of a fiscal year in a form, the one its conformances resolve by default, with the
     * figures of the year before. The result of the year is part of the result position of the form, whether or not
     * the year is closed. A closed year answers the statement archived at its closing. Read in the transaction given,
     * such as the one of a closing.
     * @throws A BadRequestError for a form that is not the structure of a balance sheet.
     */
    resolveBalanceSheet: (fiscalYearId: string, form: string | undefined, transaction?: Transaction) => Promise<BookkeepingStatement>,
    /**
     * Resolves the income statement of a fiscal year in a form, the one its conformances resolve by default. Read in
     * the transaction given, such as the one of a closing.
     * @throws A BadRequestError for a form that is not the structure of an income statement.
     */
    resolveIncomeStatement: (fiscalYearId: string, form: string | undefined, transaction?: Transaction) => Promise<BookkeepingStatement>,
    /**
     * Resolves the forms the statements of a fiscal year are in by default: those the first of its conformances
     * resolving any resolves, or else the full structures.
     */
    resolveStatementForms: (fiscalYearId: string) => Promise<BookkeepingStatementForms>,
    /**
     * Resolves, for the balance sheet and the income statement of a fiscal year, the form that applies, as
     * `resolveStatementForms` does, and every form it can be shown in: each structure of the statement, with its name
     * in the locale of the request.
     * @throws A NotFoundError for a fiscal year the current tenant does not have.
     */
    resolveStatementFormChoices: (fiscalYearId: string) => Promise<BookkeepingStatementFormChoices>,
    /**
     * Resolves the revenue of a calendar year: the credits less the debits of each revenue account in it.
     */
    resolveRevenue: (year: number) => Promise<BookkeepingRevenueReport>,
    /**
     * Archives the balance sheet and the income statement of a fiscal year about to be closed, in the forms that apply
     * and in the full forms, each with its pdf, in the transaction it is closed in: everything they are resolved from
     * is read in it, which sees what the closing wrote before.
     */
    archiveStatements: (fiscalYear: FiscalYear, transaction: Transaction) => Promise<FiscalYearStatement[]>,
    /**
     * Finds a statement archived at the closing of a fiscal year: in a form, or in the one that applied. Read in the
     * transaction given.
     * @returns The statement, or undefined for a form not archived or a fiscal year not closed.
     */
    findArchivedStatement: (
        fiscalYear: FiscalYear,
        type: BookkeepingStatementType,
        form: string | undefined,
        transaction?: Transaction
    ) => Promise<FiscalYearStatement | undefined>
}