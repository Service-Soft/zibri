import { type KeptRowCheckInterface } from '../../../backup/kept-row-check.interface';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BankMatchPostingInterface } from '../../bank/services/bank-match-posting.interface';
import { type InvoicePostingInterface } from '../../invoicing/services/invoice-posting.interface';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { type JournalEntry } from '../models/journal-entry.model';
import { type PostingSourceType } from '../models/posting-source-type.enum';
import { type PostingSource } from '../models/posting-source.model';

/**
 * Posts the entries of invoices, credit notes, expenses and bank matches of the current tenant, by the posting rules
 * of the posting rule service. A source is posted once, and a tenant without bookkeeping settings keeps no books, so
 * nothing of it is posted. It is the posting the invoicing plugin hands issued invoices to, and the bank plugin its
 * matches. Finds the entries, receipts and matches of expenses kept as they were written that no longer match the
 * sources they were written from, such as after a restore of a tenant.
 */
export interface PostingServiceInterface extends InvoicePostingInterface, BankMatchPostingInterface, KeptRowCheckInterface {
    /**
     * Posts the entry of a source, with the source on the entry. A source posted before posts nothing again: the
     * entry it posted is answered when it stands and posts what the source posts now.
     * @param source - The source.
     * @param transaction - The transaction of the source, so that one rolled back posts nothing. One of its own by
     * default.
     * @returns The entry, or undefined for a tenant without settings or a source of nothing to post.
     * @throws A ConflictError for a source posted already by an entry that is reversed, or that posts other amounts or
     * another day, and what posting the entry refuses it with.
     */
    postFor: (source: PostingSource, transaction?: Transaction) => Promise<JournalEntryDetails | undefined>,
    /**
     * Finds the entry posted of a source.
     * @param sourceType - The kind of source.
     * @param sourceId - The id of the source.
     * @param transaction - The transaction, if any.
     * @returns The entry, or undefined for a source not posted.
     */
    findEntryOf: (sourceType: PostingSourceType, sourceId: string, transaction?: Transaction) => Promise<JournalEntry | undefined>
}