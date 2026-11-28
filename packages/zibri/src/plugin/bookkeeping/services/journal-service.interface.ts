import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingAccountFilter } from '../models/bookkeeping-account-filter.model';
import { type BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingCarriedBalances } from '../models/bookkeeping-carried-balances.model';
import { type BookkeepingClosingProposal } from '../models/bookkeeping-closing-proposal.model';
import { type BookkeepingObligation } from '../models/bookkeeping-obligation.model';
import { type BookkeepingSettingsChange } from '../models/bookkeeping-settings-change.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { type BookkeepingVerification } from '../models/bookkeeping-verification.model';
import { type FiscalYearChange } from '../models/fiscal-year-change.model';
import { type FiscalYearClosingResult } from '../models/fiscal-year-closing-result.model';
import { type FiscalYearClosing } from '../models/fiscal-year-closing.model';
import { type FiscalYearReopeningResult } from '../models/fiscal-year-reopening-result.model';
import { type FiscalYearReopeningPosting } from '../models/fiscal-year-reopening.model';
import { type FiscalYear } from '../models/fiscal-year.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { type JournalEntryFilter } from '../models/journal-entry-filter.model';
import { type JournalEntryPage } from '../models/journal-entry-page.model';
import { type JournalEntryPosting } from '../models/journal-entry-posting.model';
import { type JournalEntryReversalPosting } from '../models/journal-entry-reversal-posting.model';
import { type NewBookkeepingSettings } from '../models/new-bookkeeping-settings.model';
import { type NewFiscalYear } from '../models/new-fiscal-year.model';

/**
 * Keeps the journal of the current tenant: its settings, posts and reverses entries, adds and closes fiscal years,
 * and checks the books. Each method taking a transaction runs in one of its own without it, of the data source of the
 * bookkeeping entities.
 */
export interface JournalServiceInterface {
    /**
     * Finds the settings of the books of the current tenant.
     * @returns The settings, or undefined for a tenant that keeps no books.
     */
    findSettings: (transaction?: Transaction) => Promise<BookkeepingSettings | undefined>,
    /**
     * Starts the books of the current tenant with their settings, which the conformances of each legal form of their
     * history validate.
     * @throws A BadRequestError for a legal form valid from a day with a time, and what a conformance throws, such as for
     * a corporation without its register.
     * @throws A ConflictError when the tenant has settings already.
     */
    createSettings: (settings: NewBookkeepingSettings, transaction?: Transaction) => Promise<BookkeepingSettings>,
    /**
     * Changes the settings of the books, each property of the change unchanged when absent: `currency` changes the
     * currency while there is no fiscal year, `legalForm` appends a legal form to the history, and `company` replaces
     * the company whole, or removes it with null, so what the company before held and the new one leaves out is gone. A
     * closed fiscal year keeps the company its archived statements name. The change is applied in one transaction and
     * validated as a whole: the conformances of each legal form of the resulting history check the resulting settings,
     * and those of the open fiscal years an appended legal form applies to their posting rules. A change that is
     * refused writes nothing.
     * @throws A BadRequestError for a legal form valid from a day with a time.
     * @throws A ConflictError for a tenant without settings, a currency changed once there is a fiscal year, and a
     * legal form valid from a day on or before the end of the last closed fiscal year or the latest legal form.
     * @throws What a conformance throws, such as for a corporation without its register, or a UG whose open fiscal year
     * has rules without its legal reserve.
     */
    updateSettings: (change: BookkeepingSettingsChange, transaction?: Transaction) => Promise<BookkeepingSettings>,
    /**
     * Posts an entry into the fiscal year its posting date falls into, numbered with the next sequence of that year.
     * The sequence is drawn in the transaction, so an entry rolled back leaves no gap.
     * @throws A BadRequestError for an entry of fewer than two lines, a line without exactly one of a debit and a
     * credit, an amount not above 0 or with more decimals than the currency of the books has, debits that do not add
     * up to the credits, or a day with a time.
     * @throws A ConflictError for a tenant without settings, a posting date outside every open fiscal year, an
     * account that is not an open account of the tenant, and for a source posted already.
     */
    post: (entry: JournalEntryPosting, transaction?: Transaction) => Promise<JournalEntryDetails>,
    /**
     * Posts the mirror of an entry: the same lines, with debit and credit swapped, referencing it. An entry is
     * reversed at most once, and a reversal is not reversed: post the corrected entry instead.
     * @throws A ConflictError for an entry reversed already, a reversal, or a posting date outside every open fiscal
     * year.
     */
    reverse: (entryId: string, reversal: JournalEntryReversalPosting, transaction?: Transaction) => Promise<JournalEntryDetails>,
    /**
     * Finds an entry with its lines.
     * @throws A NotFoundError for an entry the current tenant does not have.
     */
    findEntry: (entryId: string) => Promise<JournalEntryDetails>,
    /**
     * Finds a page of the entries with their lines, by posting date and sequence, of those the filter matches: of its
     * fiscal year, posted on its days from `from` to `until`, and with a line on its account, each where given. Its
     * `totalAmount` counts every entry matching, and its `debit` and `credit` add up the lines of every entry matching,
     * those on the account alone where the filter names one.
     * @throws A BadRequestError for a `from` or `until` with a time, an `until` before `from`, or an account the
     * current tenant does not have.
     */
    findEntries: (page: number, limit: number, filter: JournalEntryFilter) => Promise<JournalEntryPage>,
    /**
     * Resolves which entry reverses each of the given entries, from the `reversesEntryId` of the reversals.
     * @param entryIds - The ids of the entries.
     * @param transaction - The transaction to read in, if any.
     * @returns The id of the reversal, by the id of the entry it reverses, with no entry for one not reversed.
     */
    resolveReversingEntryIds: (entryIds: string[], transaction?: Transaction) => Promise<Map<string, string>>,
    /**
     * Finds the accounts of the books, by number: those whose number starts with a `search`, or whose name contains it,
     * whatever its case, and those that are `open`, not closed, or not.
     * @param filter - The search and whether they are open.
     * @returns The accounts.
     */
    findAccounts: (filter: BookkeepingAccountFilter) => Promise<BookkeepingAccount[]>,
    /**
     * Adds a fiscal year, the day after the end of the latest one, or on `start` for the first. A fiscal year after
     * another starts with a copy of the posting rules valid at the end of that one.
     * @throws A ConflictError for a fiscal year overlapping one or leaving a gap after the latest, and for a
     * conformance that is not registered.
     */
    createFiscalYear: (fiscalYear: NewFiscalYear, transaction?: Transaction) => Promise<FiscalYear>,
    /**
     * Changes an open fiscal year, such as its average number of employees before it is closed.
     * @throws A NotFoundError for a fiscal year the current tenant does not have.
     * @throws A ConflictError for a fiscal year that is closed.
     */
    updateFiscalYear: (fiscalYearId: string, change: FiscalYearChange, transaction?: Transaction) => Promise<FiscalYear>,
    /**
     * Resolves the entries the conformances of a fiscal year propose to post before it is closed.
     */
    resolveClosingProposals: (fiscalYearId: string) => Promise<BookkeepingClosingProposal[]>,
    /**
     * Resolves what the conformances of a closed fiscal year ask of it, such as filing its E-Bilanz, with their
     * deadlines. None for an open fiscal year.
     */
    resolveObligations: (fiscalYearId: string) => Promise<BookkeepingObligation[]>,
    /**
     * Closes a fiscal year: refuses every further posting into it, archives its statements with their pdfs, which its
     * reports answer from then on, carries its revenue and expenses into the result
     * account, and posts the balances of the balance sheet accounts as the opening balances of the next fiscal year,
     * which it creates when it is missing. The conformances of the year validate the closing first.
     * @throws A ConflictError for a fiscal year closed already or following one that is open, and for a result
     * account that is not an equity account.
     */
    closeFiscalYear: (fiscalYearId: string, closing: FiscalYearClosing, transaction?: Transaction) => Promise<FiscalYearClosingResult>,
    /**
     * Reopens a closed fiscal year to correct its books: reverses the entry that closed it and the opening balances
     * the next fiscal year took from it, and lets it be posted into and closed again, which posts both anew and
     * archives its statements anew. Nothing of the closing is changed or deleted: its entries stay with their
     * reversals, and its statements stay archived beside those of the next closing. The conformances of the year
     * validate the reopening first, such as that its accounts are not filed yet.
     * @throws A ConflictError for an open fiscal year, one whose next fiscal year is closed, or one a conformance
     * refuses to reopen.
     */
    reopenFiscalYear: (fiscalYearId: string, reopening: FiscalYearReopeningPosting, transaction?: Transaction) => Promise<FiscalYearReopeningResult>,
    /**
     * Resolves the balances a fiscal year starts with: the lines of its opening entry, and those of each entry with a
     * line on a carry-forward account, an equity account in no position, such as `9000` of the SKR 03 and 04, which the
     * balances of books kept elsewhere before are carried over against by hand.
     */
    resolveCarriedBalances: (fiscalYearId: string, transaction?: Transaction) => Promise<BookkeepingCarriedBalances>,
    /**
     * Resolves whether the books of the current tenant hold: the chains of its entries and of its lines, and that
     * every entry has at least two lines whose debits add up to their credits.
     */
    resolveVerification: () => Promise<BookkeepingVerification>
}
