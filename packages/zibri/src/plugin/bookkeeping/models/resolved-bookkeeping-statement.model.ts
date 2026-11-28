import { type BookkeepingAccountAmount } from './bookkeeping-account-amount.model';
import { type BookkeepingStatementPosition } from './bookkeeping-statement-position.model';

/**
 * The positions and the accounts without a position of a statement, as `resolveStatement` of the
 * `BookkeepingStatementUtilities` answers them.
 */
export type ResolvedBookkeepingStatement = {
    /**
     * Every position of the structure, in its order.
     */
    positions: BookkeepingStatementPosition[],
    /**
     * The accounts of the statement with a balance and no position.
     */
    unmapped: BookkeepingAccountAmount[]
};