import { type ApprovalRequestModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalActorKind } from './approval-actor-kind.enum';
import { ApprovalPrecondition } from './approval-precondition.model';
import { ApprovalRequestChange } from './approval-request-change.model';
import { ApprovalRequestStatus } from './approval-request-status.enum';

/**
 * An action proposed for approval: what runs once it is approved, who proposed it, and where it stands.
 */
@Entity({ allowOrphan: true, indexes: [['status', 'expiresAt'], ['tenantId', 'proposedAt']] })
export class ApprovalRequest extends BaseEntity implements ApprovalRequestModel {
    /**
     * The tenant the request belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The name of the action proposed, such as `tasks.close`.
     */
    @Property.string()
    action!: string;

    /**
     * What the action runs with, as its input model describes it.
     */
    @Property.unknown()
    input!: unknown;

    /**
     * Why the proposer proposes it, if they said.
     */
    @Property.string({ required: false })
    reason?: string | null;

    /**
     * What the action does, for the reviewer.
     */
    @Property.string()
    summary!: string;

    /**
     * The rows the action writes, and what it changes on each.
     */
    @Property.array({ items: { type: 'object', cls: () => ApprovalRequestChange } })
    changes!: ApprovalRequestChange[];

    /**
     * The rows the request was proposed against, which approving checks are unchanged.
     */
    @Property.array({ items: { type: 'object', cls: () => ApprovalPrecondition } })
    preconditions!: ApprovalPrecondition[];

    /**
     * The id of the user, or the name of the part of the application, that proposed it.
     */
    @Property.string()
    proposedBy!: string;

    /**
     * Whether a user or the system proposed it.
     */
    @Property.string({ enum: ApprovalActorKind })
    proposedByKind!: ApprovalActorKind;

    /**
     * When it was proposed.
     */
    @Property.date()
    proposedAt!: Date;

    /**
     * Where the request stands.
     */
    @Property.string({ enum: ApprovalRequestStatus })
    status!: ApprovalRequestStatus;

    /**
     * When the request expires, unless it is decided before.
     */
    @Property.date()
    expiresAt!: Date;
}

/**
 * What an approval request is created with.
 */
export type ApprovalRequestCreateData = Omit<ApprovalRequest, 'id' | 'tenantId'>;