import { type Readable } from 'node:stream';

import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingStatement } from '../models/bookkeeping-statement.model';

/**
 * Renders the reports of the books of the current tenant as pdfs, in the locale of the request. Each answers the
 * report of the report service of the same arguments, as a readable of the finished pdf. A statement of a closed
 * fiscal year answers the pdf archived at its closing.
 */
export interface BookkeepingReportPdfServiceInterface {
    /**
     * Renders the journal of the days from `from` to `until`.
     */
    resolveJournalPdf: (from: Date, until: Date) => Promise<Readable>,
    /**
     * Renders the ledger of an account on the days from `from` to `until`.
     */
    resolveLedgerPdf: (accountId: string, from: Date, until: Date) => Promise<Readable>,
    /**
     * Renders the trial balance of a fiscal year up to `until`.
     */
    resolveTrialBalancePdf: (fiscalYearId: string, until: Date | undefined) => Promise<Readable>,
    /**
     * Renders the balance sheet of a fiscal year in a form, which its conformances update, such as with a note below
     * it, or answers the one archived at its closing.
     */
    resolveBalanceSheetPdf: (fiscalYearId: string, form: string | undefined) => Promise<Readable>,
    /**
     * Renders the income statement of a fiscal year in a form, which its conformances update, or answers the one
     * archived at its closing.
     */
    resolveIncomeStatementPdf: (fiscalYearId: string, form: string | undefined) => Promise<Readable>,
    /**
     * Renders the revenue of a calendar year.
     */
    resolveRevenuePdf: (year: number) => Promise<Readable>,
    /**
     * Renders a statement as it is given, updated by the conformances of its fiscal year, such as to archive it. What
     * it is rendered with is read in the transaction given, such as the one of a closing.
     */
    resolveStatementDocument: (statement: BookkeepingStatement, transaction?: Transaction) => Promise<Readable>
}
