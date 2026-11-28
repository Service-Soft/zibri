import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { ApprovalActorKind } from '../../approval/models/approval-actor-kind.enum';
import { BankLimits } from './bank-limits.model';
import { BankMatchTargetType } from './bank-match-target-type.enum';

/**
 * A confirmed match of a bank transaction with what it pays, such as an invoice: the part of the transaction that pays
 * it. A transaction can pay several invoices, and an invoice can be paid by several transactions, each with a match of
 * its own.
 */
@Entity({ allowOrphan: true, appendOnly: true, indexes: [['transactionId'], ['targetType', 'targetId']] })
export class BankMatch extends BaseEntity {
    /**
     * The tenant the match belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

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
     * The id of what the transaction is matched with, such as the id of the invoice.
     */
    @Property.string()
    targetId!: string;

    /**
     * The part of the transaction that pays it, above zero, or below zero for a match reversing another.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;

    /**
     * What of an invoice the match leaves open within `paymentDifferenceTolerance` of the matching options, which
     * counts as paid with it, or null for none. Below zero for a match reversing another.
     */
    @Property.number({ format: 'bignumber', required: false })
    difference?: BigNumber | null;

    /**
     * The currency of the amount, such as `EUR`.
     */
    @Property.string({ regex: BankLimits.CURRENCY_REGEX })
    currency!: string;

    /**
     * The id of the match this one reverses, or null for a match that reverses none. Unique, so that a match is
     * reversed at most once.
     */
    @Property.string({ format: 'uuid', required: false, unique: true })
    reversesMatchId?: string | null;

    /**
     * The id of the approval request the match was confirmed through, or null for a match reversing another.
     */
    @Property.string({ format: 'uuid', required: false })
    requestId?: string | null;

    /**
     * The id of the user, or the name of the policy, that confirmed the match.
     */
    @Property.string()
    confirmedBy!: string;

    /**
     * Whether a user or a policy confirmed the match.
     */
    @Property.string({ enum: ApprovalActorKind })
    confirmedByKind!: ApprovalActorKind;

    /**
     * When the match was confirmed.
     */
    @Property.date()
    confirmedAt!: Date;
}

/**
 * What a match is created with.
 */
export type BankMatchCreateData = Omit<BankMatch, 'id' | 'tenantId'>;