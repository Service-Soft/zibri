/**
 * A bank account of a tenant, as `GET /bank/accounts` and `POST /bank/accounts` answer it.
 */
export type BankAccountModel = {
    /**
     * The id of the account.
     */
    id: string,
    /**
     * The tenant the account belongs to.
     */
    tenantId: string,
    /**
     * The IBAN of the account, in capitals and without spaces, such as `DE89370400440532013000`. Unique among the
     * accounts of its tenant.
     */
    iban: string,
    /**
     * What the tenant calls the account, such as `Business account`.
     */
    name: string,
    /**
     * The currency the account is kept in, such as `EUR`.
     */
    currency: string
};