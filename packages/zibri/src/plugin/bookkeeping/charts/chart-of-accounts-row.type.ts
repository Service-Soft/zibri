import { type BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';

/**
 * An account of a chart as a row of its table: the number, the name, the type, the position of the account while its
 * balance is a debit, and the position while its balance is a credit where that one differs.
 */
export type ChartOfAccountsRow = [
    number: string,
    name: string,
    type: BookkeepingAccountType,
    statementPosition?: string,
    creditStatementPosition?: string
];