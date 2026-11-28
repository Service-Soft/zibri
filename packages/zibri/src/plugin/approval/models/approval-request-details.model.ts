import { type ApprovalRequestDetailsModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalDecision } from './approval-decision.model';
import { ApprovalRequest } from './approval-request.model';

/**
 * An approval request and its decision, as reading, proposing, approving and rejecting one answer it.
 */
export class ApprovalRequestDetails implements ApprovalRequestDetailsModel {
    /**
     * The request.
     */
    @Property.object({ cls: () => ApprovalRequest })
    request!: ApprovalRequest;

    /**
     * The decision on it, or null while there is none.
     */
    @Property.object({ cls: () => ApprovalDecision, required: false })
    decision!: ApprovalDecision | null;
}