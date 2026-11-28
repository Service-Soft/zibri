import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { JournalEntryLineRole } from './journal-entry-line-role.enum';

/**
 * A line of a posted journal entry: an amount on the debit or the credit side of an account, in the currency of the
 * books. The lines of each tenant form a hash chain of their own, and each is archived as long as its entry.
 */
// the retention here is the default of the plugin, which gives each line the retainUntil of its entry instead
@Entity({ allowOrphan: true, chained: true, indexes: [['entryId'], ['fiscalYearId', 'accountId']] })
@Archive({ retention: { years: 10 } })
export class JournalEntryLine extends BaseArchivedEntity {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the entry the line belongs to.
     */
    @Property.string({ format: 'uuid' })
    entryId!: string;

    /**
     * The id of the fiscal year of the entry, which the balances of a year are added up by.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The id of the account booked on.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The amount on the debit side, above 0, or null for a line on the credit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    debit?: BigNumber | null;

    /**
     * The amount on the credit side, above 0, or null for a line on the debit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    credit?: BigNumber | null;

    /**
     * What the line does beyond its amount, such as `RESULT` for the line of the closing entry carrying the result of
     * the year into equity, or null for an ordinary line. Only the closing of a fiscal year sets one.
     */
    @Property.string({ enum: JournalEntryLineRole, required: false })
    role?: JournalEntryLineRole | null;
}
