import { type NewAccountMatchRuleModel } from './new-account-match-rule.model';

/**
 * A rule suggesting the account of the books a bank transaction is matched with, as
 * `GET /bookkeeping/account-match-rules` answers it.
 */
export type AccountMatchRuleModel = NewAccountMatchRuleModel & {
    /**
     * The id of the rule.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string
};