import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingLimits } from './bookkeeping-limits.model';
import { BookkeepingStatementType } from './bookkeeping-statement-type.enum';
import { BookkeepingStatement } from './bookkeeping-statement.model';

/**
 * A statement of a closed fiscal year in one form, archived unchanged at its closing with its pdf: the balance sheet
 * and the income statement in the forms that applied, and in the full forms. A statement of a closed fiscal year is
 * answered from it, whatever the accounts are mapped to since. A fiscal year reopened and closed again archives its
 * statements anew, numbered by its `closing`, and those of an earlier closing are kept and no longer answered. Kept for
 * the `retention` of the bookkeeping plugin, counted from the end of the calendar year the fiscal year ends in.
 */
// the retention here is the default of the plugin, which counts each row's retainUntil from its options instead
@Entity({ allowOrphan: true, chained: true, uniques: [['fiscalYearId', 'closing', 'form']] })
@Archive({ retention: { years: 10 }, dateProperty: 'end' })
export class FiscalYearStatement extends BaseArchivedEntity {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The last day of the fiscal year.
     */
    @Property.date()
    end!: Date;

    /**
     * The closing of the fiscal year it was archived at, 1 for the first. The fiscal year answers those of the closing
     * after its last reopening, `reopenings` + 1.
     */
    @Property.number({ format: 'integer', min: 1, default: () => 1 })
    closing!: number;

    /**
     * What the statement states.
     */
    @Property.string({ enum: BookkeepingStatementType })
    type!: BookkeepingStatementType;

    /**
     * The id of the form it is in, such as `hgb.balance-sheet.micro`.
     */
    @Property.string({ maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    form!: string;

    /**
     * Whether it is in the form the conformances of the fiscal year resolved at its closing, which a statement asked
     * for without a form answers.
     */
    @Property.boolean()
    applies!: boolean;

    /**
     * The statement as it was at the closing.
     */
    @Property.object({ cls: () => BookkeepingStatement })
    statement!: BookkeepingStatement;

    /**
     * The pdf of the statement, kept in the file store `receiptStore` of the bookkeeping plugin options names.
     */
    @Property.file({
        store: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.RECEIPT_FILE_STORE,
        allowedMimeTypes: 'all',
        maxSize: BookkeepingLimits.STATEMENT_MAX_SIZE
    })
    file!: string;

    /**
     * When it was archived.
     */
    @Property.date()
    archivedAt!: Date;
}

/**
 * What an archived statement is created with: everything but what the repository and the chain fill in.
 */
export type FiscalYearStatementCreateData = OmitStrict<
    FiscalYearStatement,
    'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'
>;