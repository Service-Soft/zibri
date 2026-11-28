import { type ApprovalActorKind } from './approval-actor-kind.enum';
import { type BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * A confirmed match of a bank transaction with what it pays, as `GET /bank/matches` answers it. The amount is a decimal
 * string, such as `'119.00'`.
 */
export type BankMatchModel = {
    /**
     * The id of the match.
     */
    id: string,
    /**
     * The tenant the match belongs to.
     */
    tenantId: string,
    /**
     * The id of the transaction.
     */
    transactionId: string,
    /**
     * What the transaction is matched with.
     */
    targetType: BankMatchTargetType,
    /**
     * The id of what the transaction is matched with, such as the id of the invoice.
     */
    targetId: string,
    /**
     * The part of the transaction that pays it, above zero, or below zero for a match reversing another.
     */
    amount: string,
    /**
     * What of an invoice the match leaves open within the payment difference tolerance, and counts as paid, or null
     * for none.
     */
    difference?: string | null,
    /**
     * The currency of the amount, such as `EUR`.
     */
    currency: string,
    /**
     * The id of the match this one reverses, or null for a match that reverses none.
     */
    reversesMatchId?: string | null,
    /**
     * The id of the approval request the match was confirmed through, or null for a match reversing another.
     */
    requestId?: string | null,
    /**
     * The id of the user, or the name of the policy, that confirmed the match.
     */
    confirmedBy: string,
    /**
     * Whether a user or a policy confirmed the match.
     */
    confirmedByKind: ApprovalActorKind,
    /**
     * When the match was confirmed.
     */
    confirmedAt: Date
};