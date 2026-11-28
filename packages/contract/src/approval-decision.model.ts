import { type ApprovalActorKind } from './approval-actor-kind.enum';
import { type ApprovalDecisionType } from './approval-decision-type.enum';

/**
 * The decision on an approval request, as the approval request routes answer it.
 */
export type ApprovalDecisionModel = {
    /**
     * The id of the decision.
     */
    id: string,
    /**
     * The tenant the decision belongs to.
     */
    tenantId: string,
    /**
     * The place of the decision in the chain of the decisions of its tenant, counting from 1.
     */
    chainSequence: number,
    /**
     * The keyed hash linking the decision to the one before it.
     */
    chainHash: string,
    /**
     * The id of the request decided.
     */
    requestId: string,
    /**
     * Whether it was approved or rejected.
     */
    decision: ApprovalDecisionType,
    /**
     * The id of the user, or the name of the policy, that decided it.
     */
    decidedBy: string,
    /**
     * Whether a user or a policy decided it.
     */
    decidedByKind: ApprovalActorKind,
    /**
     * When it was decided.
     */
    decidedAt: Date,
    /**
     * What the decider noted, if anything.
     */
    note?: string | null,
    /**
     * What the action answered, once it ran.
     */
    result?: unknown,
    /**
     * Why the action failed, once it ran and failed.
     */
    error?: string | null
};