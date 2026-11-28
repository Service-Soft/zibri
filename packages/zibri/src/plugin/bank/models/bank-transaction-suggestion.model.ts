import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BankMatchReason } from './bank-match-reason.enum';
import { BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * A match of a transaction waiting to be approved or rejected: a pending approval request of the action `bank.match`,
 * as `GET /transactions/:id/suggestions` answers it.
 */
export class BankTransactionSuggestion {
    /**
     * The id of the approval request, which the routes of the approval requests decide it by.
     */
    @Property.string({ format: 'uuid' })
    requestId!: string;

    /**
     * What the transaction would be matched with.
     */
    @Property.string({ enum: BankMatchTargetType })
    targetType!: BankMatchTargetType;

    /**
     * The id of what the transaction would be matched with, such as the id of the invoice.
     */
    @Property.string()
    targetId!: string;

    /**
     * The part of the transaction that would be matched.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;

    /**
     * How sure the bank plugin is of the match, from 0 to 1, or null for a match a user proposed.
     */
    @Property.number({ min: 0, max: 1, required: false })
    confidence!: number | null;

    /**
     * What made the bank plugin suggest the match, none for a match a user proposed.
     */
    @Property.array({ items: { type: 'string', enum: BankMatchReason } })
    reasons!: BankMatchReason[];

    /**
     * What of an invoice the match would leave open within `paymentDifferenceTolerance` of the matching options, and
     * count as paid, as confirming it records it. Null for none, and for every target other than an invoice.
     */
    @Property.number({ format: 'bignumber', required: false })
    paymentDifference!: BigNumber | null;

    /**
     * What the match does, for the reviewer: the summary of the request.
     */
    @Property.string()
    summary!: string;
}
