import { type BankMatchReason } from './bank-match-reason.enum';
import { type BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * A match of a transaction waiting to be approved or rejected, as `GET /bank/transactions/:id/suggestions` answers
 * it: a pending approval request of the action `bank.match`, decided through the routes of the approval requests by
 * its `requestId`. The amounts are decimal strings, such as `'119.00'`.
 */
export type BankTransactionSuggestionModel = {
    /**
     * The id of the approval request.
     */
    requestId: string,
    /**
     * What the transaction would be matched with.
     */
    targetType: BankMatchTargetType,
    /**
     * The id of what the transaction would be matched with, such as the id of the invoice.
     */
    targetId: string,
    /**
     * The part of the transaction that would be matched.
     */
    amount: string,
    /**
     * How sure the bank plugin is of the match, from 0 to 1, or null for a match a user proposed.
     */
    confidence: number | null,
    /**
     * What made the bank plugin suggest the match, none for a match a user proposed.
     */
    reasons: BankMatchReason[],
    /**
     * What of an invoice the match would leave open within the payment difference tolerance, and count as paid, as
     * confirming it records it. Null for none, and for every target other than an invoice.
     */
    paymentDifference: string | null,
    /**
     * What the match does, for the reviewer, such as `Match 50 EUR paid by SIEMENS AG on 2026-11-11 with the invoice
     * 2026-SIEMEN-0002.`.
     */
    summary: string
};
