/**
 * Whether something of a bank transaction is left to match, as `GET /bank/transactions` narrows by it.
 */
export enum BankTransactionStatus {
    /**
     * A part of the transaction is not matched yet: its open amount is not zero.
     */
    OPEN = 'OPEN',
    /**
     * The whole transaction is matched: its open amount is zero.
     */
    MATCHED = 'MATCHED'
}
