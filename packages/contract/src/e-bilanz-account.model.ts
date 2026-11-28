/**
 * An account under a position of an E-Bilanz, as its account level detail (Kontennachweis) states it.
 */
export type EBilanzAccountModel = {
    /**
     * The id of the account.
     */
    accountId: string,
    /**
     * The number of the account.
     */
    number: string,
    /**
     * The name of the account.
     */
    name: string,
    /**
     * The balance of the account, positive on the side the position counts, as a decimal.
     */
    balance: string
};