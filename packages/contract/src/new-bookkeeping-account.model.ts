import { type BookkeepingAccountType } from './bookkeeping-account-type.enum';

/**
 * An account to add to the books of a tenant, as `POST /bookkeeping/accounts` takes it.
 */
export type NewBookkeepingAccountModel = {
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
     * The position of the balance sheet or the income statement the account is reported in, such as `assets.B.IV`, or
     * null for none. A position of a full statement, without positions below it.
     */
    statementPosition?: string | null,
    /**
     * The position the account is reported in while its balance is a credit, such as
     * `equity-and-liabilities.C.2` for a bank account that is overdrawn, or null for none.
     */
    creditStatementPosition?: string | null
};
