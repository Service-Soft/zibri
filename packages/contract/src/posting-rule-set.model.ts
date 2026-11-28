import { type PostingRulesModel } from './posting-rules.model';

/**
 * The posting rules of a fiscal year from a day on, as `GET /bookkeeping/posting-rule-sets` answers them. A document
 * is posted by the rule set of its fiscal year valid on its day: the one with the latest `validFrom` on or before it.
 */
export type PostingRuleSetModel = {
    /**
     * The id of the rule set.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The id of the fiscal year the rules are of.
     */
    fiscalYearId: string,
    /**
     * The first day the rules apply on, at midnight UTC, until the next rule set of the fiscal year.
     */
    validFrom: Date,
    /**
     * The rules.
     */
    rules: PostingRulesModel
};