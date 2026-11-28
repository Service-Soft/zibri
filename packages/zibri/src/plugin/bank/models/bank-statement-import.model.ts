import { Property } from '../../../entity/decorators/property.decorator';
import { BankStatement } from './bank-statement.model';

/**
 * What importing a CAMT.053 file stored, as `importStatements` and `POST /statements` answer it.
 */
export class BankStatementImport {
    /**
     * The statements of the file that were stored.
     */
    @Property.array({ items: { type: 'object', cls: () => BankStatement } })
    statements!: BankStatement[];

    /**
     * How many statements of the file were skipped, as imported before or holding no transaction that was not.
     */
    @Property.number({ format: 'integer' })
    skippedStatementCount!: number;

    /**
     * How many transactions were stored.
     */
    @Property.number({ format: 'integer' })
    transactionCount!: number;

    /**
     * How many booked transactions of the file were skipped as imported before.
     */
    @Property.number({ format: 'integer' })
    skippedTransactionCount!: number;
}