import { type BigNumber } from '../../../utilities/number.utilities';
import { type ApprovalRowChange } from '../../approval/models/approval-row-change.model';

/**
 * What a transaction is about to be matched with, as a matcher resolves it.
 */
export type BankMatchTarget = {
    /**
     * What the summary of a suggestion names it as, such as `the expense R-17 of Office Supplies GmbH`.
     */
    label: string,
    /**
     * What of it is open, which a match does not exceed, or null for a target without a limit, such as an account.
     */
    open: BigNumber | null,
    /**
     * The row of the target as it is stored, which a suggestion is proposed against, so that approving one of a
     * target changed since is refused.
     */
    row: ApprovalRowChange
};