import { type BookkeepingAccountAmountModel } from './bookkeeping-account-amount.model';

/**
 * A position of a statement with its amount, such as `assets.B.IV` with the bank accounts. Its amount is a decimal
 * string, such as `'25821.00'`.
 */
export type BookkeepingStatementPositionModel = {
    /**
     * The id of the position, such as `assets.B.IV`.
     */
    id: string,
    /**
     * The id of the position it is below, or null for a position at the top.
     */
    parentId: string | null,
    /**
     * How deep it is below the top, 0 for a position at the top.
     */
    depth: number,
    /**
     * The label of the position, in the locale of the request.
     */
    label: string,
    /**
     * The amount: what the accounts of the position and the positions below it add up to. A balance on the side
     * the statement counts the position by adds, the other side subtracts.
     */
    amount: string,
    /**
     * The amount of the position in the fiscal year before, or null for a statement without one, such as of the first
     * fiscal year of the books.
     */
    previousAmount: string | null,
    /**
     * The accounts reported in the position, or in the positions of the full statement a shortened position adds up.
     */
    accounts: BookkeepingAccountAmountModel[]
};
