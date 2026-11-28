import { FrameworkColumnRegistry } from '../../../data-source/migration/framework-column.registry';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * How many numbers of a scope a tenant has drawn: of the invoice number format rendered without its
 * counter, such as `2026-SIEMEN-{counter}`.
 */
// one counter per scope in each tenant. Besides keeping a second counter row from ever existing, the
// key on year and recipient is what lets resolveCounter claim its number in a single statement instead of
// reading and writing it back, the way 3.2 claims it: see InvoiceNumberService.getCounterKey
// TODO 4.0: drop the key on year and recipient, and the two columns, keeping the one on the scope
@Entity({ allowOrphan: true, uniques: [['year', 'recipientId'], ['scope']] })
export class NumberInvoices extends BaseEntity {
    /**
     * The tenant whose invoices are counted.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * The invoice number format the counter counts for, rendered with `{counter}` left in it, such as
     * `2026-SIEMEN-{counter}`. Null for a counter an instance of 3.2 created, until the next start.
     */
    @Property.string({ required: false })
    scope?: string | null;
    /**
     * The id of the recipient counted for the default number format, and the `scope` for any other
     * format and for credit notes.
     */
    // TODO 4.0: remove, together with year. Both are required columns of 3.0, which a release cannot
    // make nullable without a migration of every application
    @Property.string()
    recipientId!: string;
    /**
     * How many numbers have been drawn.
     */
    @Property.number({ format: 'integer' })
    number!: number;
    /**
     * The year counted for the default number format, and 0 for any other format and for credit notes.
     */
    @Property.number({ format: 'integer' })
    year!: number;
}

// without the column, a counter is kept by year and recipient alone, as in 3.2, and InvoiceNumberService refuses a
// number of a format that needs a scope to tell its counter apart
FrameworkColumnRegistry.register({ entity: NumberInvoices, property: 'scope', meansAbsent: () => true });