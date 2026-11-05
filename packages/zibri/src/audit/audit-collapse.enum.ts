/**
 * How an entry stands for the refusals past the minute's budget.
 */
export enum AuditCollapse {
    /**
     * Every refusal of one kind: the same tenant, action, reason, subject, user, role, scopes and
     * address. The entry carries what they share.
     */
    PER_KIND = 'per-kind',
    /**
     * Every refusal of one action and reason past the kinds kept apart. The entry carries only those two.
     */
    PAST_KINDS = 'past-kinds'
}