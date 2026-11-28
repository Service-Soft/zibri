/* eslint-disable typescript/typedef */
/**
 * What the approval request routes take at most.
 */
export abstract class ApprovalLimits {
    /**
     * The longest name of an action.
     */
    static readonly ACTION_MAX_LENGTH = 200;
    /**
     * The longest reason of a proposal, and note of a decision.
     */
    static readonly TEXT_MAX_LENGTH = 2000;
    /**
     * The most requests a page of `GET /` holds.
     */
    static readonly PAGE_MAX_LIMIT = 100;
}