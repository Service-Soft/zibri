import { type BankMatchReason } from './bank-match-reason.enum';
import { type BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * What the approval action `bank.match` runs with, as the `input` of its approval requests and of proposing one: the
 * part of a transaction that pays an invoice or an expense, or that is booked against an account, and why the bank
 * plugin suggested it. The amount is a decimal string, such as `'119.00'`.
 */
export type BankMatchInputModel = {
    /**
     * The id of the transaction.
     */
    transactionId: string,
    /**
     * What the transaction is matched with.
     */
    targetType: BankMatchTargetType,
    /**
     * The id of what the transaction is matched with, such as the id of the invoice it pays.
     */
    targetId: string,
    /**
     * The part of the transaction that is matched, above zero.
     */
    amount: string,
    /**
     * How sure the bank plugin is of the match, from 0 to 1. None for a match a user proposes.
     */
    confidence?: number | null,
    /**
     * What made the bank plugin suggest the match. None for a match a user proposes.
     */
    reasons?: BankMatchReason[] | null
};