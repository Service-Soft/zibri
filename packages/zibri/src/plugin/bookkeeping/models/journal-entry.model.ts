import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A posted entry of the journal of a tenant. It is never changed: a wrong entry is corrected by reversing it. Its
 * lines are rows of their own, `JournalEntryLine`. The entries of each tenant form a hash chain, and each is archived
 * for the retention of the bookkeeping plugin, counted from the end of its fiscal year.
 */
// the retention here is the default of the plugin, which counts each row's retainUntil from its options and the end
// of the fiscal year instead. Unique by its source, so that what created an entry, such as an invoice, posts once
@Entity({
    allowOrphan: true,
    chained: true,
    uniques: [['fiscalYearId', 'sequence'], ['sourceType', 'sourceId']],
    indexes: [['postingDate']]
})
@Archive({ retention: { years: 10 }, dateProperty: 'postingDate' })
export class JournalEntry extends BaseArchivedEntity {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the fiscal year its posting date falls into.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The number of the entry in its fiscal year, counting from 1 without a gap. Unique among the entries of its
     * fiscal year.
     */
    @Property.number({ format: 'integer', min: 1 })
    sequence!: number;

    /**
     * The day of the document the entry is booked from, such as the date of an invoice, at midnight UTC.
     */
    @Property.date()
    documentDate!: Date;

    /**
     * The day the entry is booked on, at midnight UTC, which decides its fiscal year.
     */
    @Property.date()
    postingDate!: Date;

    /**
     * The number of the document, such as the number of an invoice, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.DOCUMENT_REFERENCE_MAX_LENGTH })
    documentReference?: string | null;

    /**
     * What was booked, such as `Rent November`.
     */
    @Property.string({ maxLength: BookkeepingLimits.TEXT_MAX_LENGTH })
    text!: string;

    /**
     * The id of the user who posted the entry, or null when no user did.
     */
    @Property.string({ required: false })
    createdBy?: string | null;

    /**
     * The id of the entry this one reverses, or null for an entry that reverses none. Unique, so that an entry is
     * reversed at most once.
     */
    @Property.string({ format: 'uuid', required: false, unique: true })
    reversesEntryId?: string | null;

    /**
     * What kind of thing created the entry, such as `bookkeeping.opening` for the opening balances of a fiscal year,
     * or null for an entry posted by hand.
     */
    @Property.string({ required: false })
    sourceType?: string | null;

    /**
     * The id of what created the entry, such as the fiscal year whose opening balances it posts, or null for an
     * entry posted by hand.
     */
    @Property.string({ required: false })
    sourceId?: string | null;

    /**
     * When the entry was posted.
     */
    @Property.date()
    postedAt!: Date;
}
