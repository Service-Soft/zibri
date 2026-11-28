import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BankTransactionStatus } from './bank-transaction-status.enum';

/**
 * What of a bank transaction is left to match: one row per transaction, created in the transaction the transaction is
 * written in, and written again in the transaction of every match of it and every reversal of one. Derived from the
 * transaction and its matches, which stay as they were written, so that the transactions are listed and narrowed by
 * it in one query.
 */
// beside the transaction rather than on it: BankTransaction and BankMatch are append only. The account, statement and
// booking date are those of the transaction, which never change, so that the list is filtered and ordered on this row
@Entity({ allowOrphan: true, uniques: [['transactionId']], indexes: [['status', 'bookingDate'], ['accountId', 'bookingDate']] })
export class BankTransactionState extends BaseEntity {
    /**
     * The tenant the transaction belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the transaction. Unique.
     */
    @Property.string({ format: 'uuid' })
    transactionId!: string;

    /**
     * The id of the bank account the transaction was booked on.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The id of the statement the transaction was first imported with.
     */
    @Property.string({ format: 'uuid' })
    statementId!: string;

    /**
     * When the bank booked the transaction.
     */
    @Property.date()
    bookingDate!: Date;

    /**
     * What of the transaction is not matched yet, without its sign: its amount less its confirmed matches.
     */
    @Property.number({ format: 'bignumber' })
    openAmount!: BigNumber;

    /**
     * `OPEN` while the open amount is not zero, `MATCHED` once it is.
     */
    @Property.string({ enum: BankTransactionStatus })
    status!: BankTransactionStatus;
}

/**
 * What a state is created with.
 */
export type BankTransactionStateCreateData = Omit<BankTransactionState, 'id' | 'tenantId'>;
