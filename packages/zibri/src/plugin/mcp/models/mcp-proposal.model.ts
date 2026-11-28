import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalRequestStatus } from '../../approval/models/approval-request-status.enum';

/**
 * What a call of a write tool answers: the approval request it proposed.
 */
export class McpProposal {
    /**
     * The id of the approval request.
     */
    @Property.string({ format: 'uuid' })
    approvalRequestId!: string;

    /**
     * Its status: `PENDING` while it waits for a person, or what a policy of the action decided.
     */
    @Property.string({ enum: ApprovalRequestStatus })
    status!: ApprovalRequestStatus;
}
