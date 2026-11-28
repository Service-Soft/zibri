import { type BookkeepingAccountType } from './bookkeeping-account-type.enum';

/**
 * An account of the books of a tenant, as `GET /bookkeeping/accounts` answers it.
 */
export type BookkeepingAccountModel = {
    /**
     * The id of the account.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The number of the account, such as `1200`. Unique among the accounts of its tenant.
     */
    number: string,
    /**
     * The name of the account, such as `Bank`.
     */
    name: string,
    /**
     * What the account holds.
     */
    type: BookkeepingAccountType,
    /**
     * The position of the balance sheet or the income statement the account is reported in, or null for none.
     */
    statementPosition?: string | null,
    /**
     * The position the account is reported in while its balance is a credit, such as
     * `equity-and-liabilities.C.2` for a bank account that is overdrawn, or null to report it in `statementPosition`
     * whatever its balance.
     */
    creditStatementPosition?: string | null,
    /**
     * When the account was closed, from which nothing is posted on it, or null for an open account.
     */
    closedAt?: Date | null
};