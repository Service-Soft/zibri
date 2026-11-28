import { type ApprovalDecisionModel } from 'zibri-contract';

import { BaseChainedEntity } from '../../../data-source/chain/base-chained-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalActorKind } from './approval-actor-kind.enum';
import { ApprovalDecisionType } from './approval-decision-type.enum';

/**
 * The decision on an approval request: who approved or rejected it, and what its action answered or failed with. The
 * decisions of each tenant form a chain, which tells one that was changed or removed apart from those written.
 */
@Entity({ allowOrphan: true, chained: true })
export class ApprovalDecision extends BaseChainedEntity implements ApprovalDecisionModel {
    /**
     * The tenant the decision belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the request decided.
     */
    @Property.string({ format: 'uuid', index: true })
    requestId!: string;

    /**
     * Whether it was approved or rejected.
     */
    @Property.string({ enum: ApprovalDecisionType })
    decision!: ApprovalDecisionType;

    /**
     * The id of the user, or the name of the policy, that decided it.
     */
    @Property.string()
    decidedBy!: string;

    /**
     * Whether a user or a policy decided it.
     */
    @Property.string({ enum: ApprovalActorKind })
    decidedByKind!: ApprovalActorKind;

    /**
     * When it was decided.
     */
    @Property.date()
    decidedAt!: Date;

    /**
     * What the decider noted, if anything.
     */
    @Property.string({ required: false })
    note?: string | null;

    /**
     * What the action answered, once it ran.
     */
    @Property.unknown({ required: false })
    result?: unknown;

    /**
     * Why the action failed, once it ran and failed.
     */
    @Property.string({ required: false })
    error?: string | null;
}

/**
 * What a decision is created with. The repository fills in where it stands in its chain.
 */
export type ApprovalDecisionCreateData = Omit<ApprovalDecision, 'id' | 'tenantId' | 'chainSequence' | 'chainHash'>;