import { type BookkeepingAccountCreateData } from '../models/bookkeeping-account.model';
import { type ChartOfAccountsRow } from './chart-of-accounts-row.type';

/**
 * The accounts of the charts the plugin exports, from the rows they are written in.
 */
export abstract class ChartOfAccountsUtilities {
    /**
     * Resolves the accounts of rows of a chart.
     * @param rows - The rows, each an account.
     * @returns The accounts, as an application creates them, in the order of the rows.
     */
    static resolveAccounts(rows: ChartOfAccountsRow[]): BookkeepingAccountCreateData[] {
        return rows.map(([number, name, type, statementPosition, creditStatementPosition]) => ({
            number,
            name,
            type,
            statementPosition: statementPosition ?? null,
            creditStatementPosition: creditStatementPosition ?? null
        }));
    }
}