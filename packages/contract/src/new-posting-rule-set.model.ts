import { type PostingRulesModel } from './posting-rules.model';

/**
 * A posting rule set to add to a fiscal year, as `POST /bookkeeping/posting-rule-sets` takes it. Days are written as
 * `2026-07-01`.
 */
export type NewPostingRuleSetModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The first day the rules apply on, within the fiscal year. Its first day by default.
     */
    validFrom?: Date | null,
    /**
     * The rules.
     */
    rules: PostingRulesModel
};
