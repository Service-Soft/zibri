import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BankMatchReason } from './bank-match-reason.enum';
import { BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * What the approval action `bank.match` runs with: the part of a transaction that pays an invoice or an expense, or
 * that is booked against an account, and why the bank plugin suggested it.
 */
export class BankMatchInput {
    /**
     * The id of the transaction.
     */
    @Property.string({ format: 'uuid' })
    transactionId!: string;

    /**
     * What the transaction is matched with.
     */
    @Property.string({ enum: BankMatchTargetType })
    targetType!: BankMatchTargetType;

    /**
     * The id of what the transaction is matched with, such as the id of the invoice it pays.
     */
    @Property.string({ format: 'uuid' })
    targetId!: string;

    /**
     * The part of the transaction that is matched, above zero.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;

    /**
     * How sure the bank plugin is of the match, from 0 to 1. None for a match a user proposes.
     */
    @Property.number({ min: 0, max: 1, required: false })
    confidence?: number | null;

    /**
     * What made the bank plugin suggest the match. None for a match a user proposes.
     */
    @Property.array({ items: { type: 'string', enum: BankMatchReason }, required: false })
    reasons?: BankMatchReason[] | null;
}
