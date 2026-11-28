import { type BookkeepingAccountCreateData } from './bookkeeping-account.model';

/**
 * A chart of accounts as data, such as the SKR 04: the accounts an application spreads into the accounts it seeds,
 * each mapped to the position of the full statements it is reported in.
 */
export type ChartOfAccounts = {
    /**
     * The id of the chart, such as `skr04`.
     */
    id: string,
    /**
     * The name of the chart, such as `SKR 04`.
     */
    name: string,
    /**
     * The accounts of the chart, by number. An account without a `statementPosition` belongs to no position, such as
     * a statistical account.
     */
    accounts: BookkeepingAccountCreateData[]
};
