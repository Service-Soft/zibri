/**
 * What a bank transaction is matched with.
 */
export enum BankMatchTargetType {
    /**
     * An invoice of the invoicing plugin: the transaction pays it.
     */
    INVOICE = 'INVOICE',
    /**
     * An expense of the bookkeeping plugin: the transaction pays it.
     */
    EXPENSE = 'EXPENSE',
    /**
     * An account of the books, such as the share capital for a deposit or another bank account for a transfer between
     * own accounts. Always confirmed by a person.
     */
    ACCOUNT = 'ACCOUNT'
}