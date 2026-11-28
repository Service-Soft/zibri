import { type Change } from './change.model';

/**
 * A value an approval request would change on a row: its `key`, the `previousValue` stored and the `newValue` the action
 * writes. Null for a value that is not there.
 */
export type ApprovalValueChangeModel = Pick<Change, 'key' | 'previousValue' | 'newValue'>;