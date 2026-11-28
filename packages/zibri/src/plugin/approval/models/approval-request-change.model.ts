import { type ApprovalRequestChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ApprovalValueChange } from './approval-value-change.model';

/**
 * A row an approval request would write, and what it would change on it.
 */
export class ApprovalRequestChange implements ApprovalRequestChangeModel {
    /**
     * The table of the row, such as `task`.
     */
    @Property.string()
    entity!: string;

    /**
     * The id of the row, or null for a row the action creates.
     */
    @Property.string({ required: false })
    id!: string | null;

    /**
     * The values the action changes, each against the value stored when the request was proposed.
     */
    @Property.array({ items: { type: 'object', cls: () => ApprovalValueChange } })
    changes!: ApprovalValueChange[];
}