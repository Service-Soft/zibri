import { type BookkeepingVerificationProblemModel } from './bookkeeping-verification-problem.model';

/**
 * What checking the books of a tenant found, as `GET /bookkeeping/verification` answers it.
 */
export type BookkeepingVerificationModel = {
    /**
     * Whether both chains hold, and every entry has at least two lines whose debits add up to their credits.
     */
    intact: boolean,
    /**
     * The place of the newest entry in the chain of the entries, or null for a chain that is broken.
     */
    newestEntrySequence: number | null,
    /**
     * The hash of the newest entry, or null for a chain that is broken.
     */
    newestEntryHash: string | null,
    /**
     * The place of the newest line in the chain of the lines, or null for a chain that is broken.
     */
    newestLineSequence: number | null,
    /**
     * The hash of the newest line, or null for a chain that is broken.
     */
    newestLineHash: string | null,
    /**
     * What does not hold: the first entry and the first line where a chain breaks, and every entry that does not
     * balance. Empty for intact books.
     */
    problems: BookkeepingVerificationProblemModel[]
};