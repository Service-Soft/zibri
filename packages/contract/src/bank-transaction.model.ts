/**
 * A booked transaction of a bank account, as `GET /bank/transactions` answers it. The amount is a decimal string,
 * such as `'1250.00'`: positive for money received, negative for money paid.
 */
export type BankTransactionModel = {
    /**
     * The id of the transaction.
     */
    id: string,
    /**
     * The tenant the transaction belongs to.
     */
    tenantId: string,
    /**
     * The id of the bank account it was booked on.
     */
    accountId: string,
    /**
     * The id of the statement it was first imported with.
     */
    statementId: string,
    /**
     * When the bank booked it.
     */
    bookingDate: Date,
    /**
     * When the money counts as received or paid, for the interest.
     */
    valueDate?: Date | null,
    /**
     * The amount, positive for money received and negative for money paid.
     */
    amount: string,
    /**
     * The currency of the amount, such as `EUR`.
     */
    currency: string,
    /**
     * Who paid or was paid.
     */
    counterpartyName?: string | null,
    /**
     * The IBAN of the account of who paid or was paid.
     */
    counterpartyIban?: string | null,
    /**
     * The text the payer gave, such as the number of the invoice it pays.
     */
    remittanceInformation?: string | null,
    /**
     * The reference the payer gave the payment, unchanged through every bank on its way.
     */
    endToEndId?: string | null,
    /**
     * The mandate of a direct debit.
     */
    mandateId?: string | null,
    /**
     * The SEPA creditor identifier of whoever collected a direct debit.
     */
    creditorId?: string | null,
    /**
     * The reference the bank gave the booking.
     */
    bankReference?: string | null,
    /**
     * What tells the transaction apart from every other of its account: the reference of the bank, or a hash of what
     * the booking holds when the bank gives none.
     */
    deduplicationKey: string
};