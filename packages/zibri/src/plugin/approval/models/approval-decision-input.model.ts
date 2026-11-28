import { type ApprovalDecisionInputModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalLimits } from './approval-limits.model';

/**
 * What approving or rejecting an approval request takes, as the `ApprovalRequestController` takes it.
 */
export class ApprovalDecisionInput implements ApprovalDecisionInputModel {
    /**
     * A note for the proposer, such as why it was rejected.
     */
    @Property.string({ required: false, maxLength: ApprovalLimits.TEXT_MAX_LENGTH })
    note?: string | null;
}