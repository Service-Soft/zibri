import { type NewApprovalRequestModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalLimits } from './approval-limits.model';

/**
 * An action to propose, as `POST /` of the `ApprovalRequestController` takes it.
 */
export class NewApprovalRequest implements NewApprovalRequestModel {
    /**
     * The name of the action, such as `tasks.close`.
     */
    @Property.string({ maxLength: ApprovalLimits.ACTION_MAX_LENGTH })
    action!: string;

    /**
     * What the action runs with, as its input model describes it.
     */
    @Property.unknown()
    input!: unknown;

    /**
     * Why it is proposed, for the reviewer.
     */
    @Property.string({ required: false, maxLength: ApprovalLimits.TEXT_MAX_LENGTH })
    reason?: string | null;
}