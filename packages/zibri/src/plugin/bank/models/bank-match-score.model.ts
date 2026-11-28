import { type BankMatchReason } from './bank-match-reason.enum';

/**
 * How sure the matching is that a transaction pays an invoice, and why.
 */
export type BankMatchScore = {
    /**
     * From 0 to 1, in hundredths.
     */
    confidence: number,
    /**
     * What adds up to the confidence.
     */
    reasons: BankMatchReason[]
};