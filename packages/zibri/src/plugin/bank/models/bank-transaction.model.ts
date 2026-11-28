import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BankLimits } from './bank-limits.model';

/**
 * A booked transaction of a bank account, imported from a statement. Each transaction of an account is stored once,
 * however many statements hold it.
 */
@Entity({ allowOrphan: true, appendOnly: true, uniques: [['accountId', 'deduplicationKey']] })
export class BankTransaction extends BaseEntity {
    /**
     * The tenant the transaction belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the bank account it was booked on.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The id of the statement it was first imported with.
     */
    @Property.string({ format: 'uuid' })
    statementId!: string;

    /**
     * When the bank booked it.
     */
    @Property.date()
    bookingDate!: Date;

    /**
     * When the money counts as received or paid, for the interest.
     */
    @Property.date({ required: false })
    valueDate?: Date | null;

    /**
     * The amount, positive for money received and negative for money paid.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;

    /**
     * The currency of the amount, such as `EUR`.
     */
    @Property.string({ regex: BankLimits.CURRENCY_REGEX })
    currency!: string;

    /**
     * Who paid or was paid.
     */
    @Property.string({ required: false })
    counterpartyName?: string | null;

    /**
     * The IBAN of the account of who paid or was paid.
     */
    @Property.string({ required: false })
    counterpartyIban?: string | null;

    /**
     * The text the payer gave, such as the number of the invoice it pays. Its lines joined by a space.
     */
    @Property.string({ required: false })
    remittanceInformation?: string | null;

    /**
     * The reference the payer gave the payment, unchanged through every bank on its way.
     */
    @Property.string({ required: false })
    endToEndId?: string | null;

    /**
     * The mandate of a direct debit.
     */
    @Property.string({ required: false })
    mandateId?: string | null;

    /**
     * The SEPA creditor identifier of whoever collected a direct debit.
     */
    @Property.string({ required: false })
    creditorId?: string | null;

    /**
     * The reference the bank gave the booking.
     */
    @Property.string({ required: false })
    bankReference?: string | null;

    /**
     * What tells the transaction apart from every other of its account: the reference of the bank, or a hash of what
     * the booking holds when the bank gives none. Unique among the transactions of its account.
     */
    @Property.string()
    deduplicationKey!: string;
}