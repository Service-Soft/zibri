import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { type FiscalYear } from '../models/fiscal-year.model';
import { type NewJournalEntry } from '../models/new-journal-entry.model';
import { type NewPostingRuleSet } from '../models/new-posting-rule-set.model';
import { type PostingRuleSet } from '../models/posting-rule-set.model';
import { type PostingRules } from '../models/posting-rules.model';
import { type PostingSource } from '../models/posting-source.model';

/**
 * Keeps the posting rules of the fiscal years of the current tenant, and turns a source, such as an invoice, into the
 * entry the rules valid on its day post. Replace it to post a source differently.
 */
export interface PostingRuleServiceInterface {
    /**
     * Resolves the entry the rules post of a source, accrual: on the day of its document, and for a bank match on the
     * day it was booked.
     * @param source - The source.
     * @param settings - The settings of the books.
     * @param transaction - The transaction it is posted in.
     * @returns The entry, without its source, or undefined for a source of nothing to post, such as an invoice of 0.
     * @throws A ConflictError for a source in another currency than the books, a day without a fiscal year or posting
     * rules, or rules that do not name an account the entry needs.
     */
    resolveEntry: (source: PostingSource, settings: BookkeepingSettings, transaction: Transaction) => Promise<NewJournalEntry | undefined>,
    /**
     * Finds the rule sets, of one fiscal year or of all, by the day they are valid from.
     */
    findRuleSets: (fiscalYearId: string | undefined) => Promise<PostingRuleSet[]>,
    /**
     * Adds a rule set to a fiscal year.
     * @throws A BadRequestError for a day with a time, and a rate, VAT category or bank account named twice.
     * @throws A ConflictError for a day outside the fiscal year or of a rule set of it already, and an account named
     * that is not one of the books.
     */
    createRuleSet: (ruleSet: NewPostingRuleSet, transaction?: Transaction) => Promise<PostingRuleSet>,
    /**
     * Replaces the rules of a rule set, which post what is posted from then on.
     * @throws A BadRequestError for a rate, VAT category or bank account named twice.
     * @throws A ConflictError for an account named that is not one of the books.
     */
    updateRuleSet: (id: string, rules: PostingRules, transaction?: Transaction) => Promise<PostingRuleSet>,
    /**
     * Copies the rule set valid at the end of a fiscal year into the next, valid from its first day.
     * @param from - The fiscal year.
     * @param to - The fiscal year after it.
     * @param transaction - The transaction the fiscal year is created in.
     * @returns The copy, or undefined for a fiscal year without rules.
     */
    copyRuleSet: (from: FiscalYear, to: FiscalYear, transaction: Transaction) => Promise<PostingRuleSet | undefined>,
    /**
     * Validates the rule sets of a fiscal year by its conformances under settings about to be stored, such as once a
     * legal form is appended.
     * @throws What a conformance throws, such as a ConflictError for the rules of a UG without the accounts of its
     * legal reserve.
     */
    validateRuleSets: (fiscalYear: FiscalYear, settings: BookkeepingSettings, transaction: Transaction) => Promise<void>
}
