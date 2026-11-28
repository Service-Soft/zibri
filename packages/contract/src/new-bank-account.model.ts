/**
 * A bank account to add, as `POST /bank/accounts` takes it.
 */
export type NewBankAccountModel = {
    /**
     * The IBAN of the account, such as `DE89 3704 0044 0532 0130 00`. Stored in capitals and without spaces.
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