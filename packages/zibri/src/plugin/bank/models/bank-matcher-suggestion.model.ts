import { type BigNumber } from '../../../utilities/number.utilities';
import { type BankMatchScore } from './bank-match-score.model';

/**
 * What a matcher suggests a transaction is matched with. The bank plugin proposes it for what is left of both.
 */
export type BankMatcherSuggestion = {
    /**
     * The id of the transaction.
     */
    transactionId: string,
    /**
     * The id of what it is matched with, such as an expense.
     */
    targetId: string,
    /**
     * What of the target is open, or null for a target without a limit, such as an account.
     */
    targetOpen: BigNumber | null,
    /**
     * How sure the matcher is, and why.
     */
    score: BankMatchScore
};
