import { type FiscalYearModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A fiscal year of the books of a tenant: its first and its last day, at midnight UTC. The fiscal years of a tenant
 * follow each other without overlapping and without a gap. Entries are posted into a fiscal year until it is closed.
 */
@Entity({ allowOrphan: true, uniques: [['start']] })
export class FiscalYear extends BaseEntity implements FiscalYearModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The first day of the fiscal year.
     */
    @Property.date()
    start!: Date;

    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    @Property.date()
    end!: Date;

    /**
     * When the fiscal year was closed, or null for an open one. Nothing is posted into a closed fiscal year.
     */
    @Property.date({ required: false })
    closedAt?: Date | null;

    /**
     * The names of the conformances that apply to the fiscal year, in place of those the legal form of the tenant at
     * its end derives, or null to derive them.
     */
    @Property.array({ items: { type: 'string', maxLength: BookkeepingLimits.CONFORMANCE_NAME_MAX_LENGTH }, required: false })
    conformances?: string[] | null;

    /**
     * The average number of employees during the fiscal year, such as for the size class of a company, or null while
     * it is not known. Changes until the fiscal year is closed.
     */
    @Property.number({ min: 0, required: false })
    averageEmployees?: number | null;

    /**
     * The text stated below the balance sheet of the fiscal year where its conformances state one, such as a micro
     * corporation in place of the notes to its financial statements, or null for none. Changes until the fiscal year is
     * closed.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NOTE_MAX_LENGTH })
    balanceSheetNote?: string | null;

    /**
     * Whether the company was founded in the fiscal year, for the first fiscal year of the books, or null when it is
     * not said. Changes until the fiscal year is closed.
     */
    @Property.boolean({ required: false })
    founded?: boolean | null;

    /**
     * The size class the company had at the balance sheet date before the first fiscal year of the books, as its
     * conformances name it, such as `SMALL`, or null when it is not said. Changes until the fiscal year is closed.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    previousSizeClass?: string | null;

    /**
     * The sequence of the entry posted into the fiscal year last, or 0 before the first. The next entry is numbered
     * with the one after it.
     */
    @Property.number({ format: 'integer', min: 0, default: () => 0 })
    lastSequence!: number;

    /**
     * How often the fiscal year was reopened after a closing, 0 for none. The statements of its latest closing are
     * those archived with the closing after the last reopening.
     */
    @Property.number({ format: 'integer', min: 0, default: () => 0 })
    reopenings!: number;
}

/**
 * What a fiscal year is created with.
 */
export type FiscalYearCreateData = Pick<
    FiscalYear,
    'start' | 'end' | 'conformances' | 'averageEmployees' | 'balanceSheetNote' | 'founded' | 'previousSizeClass'
>;
