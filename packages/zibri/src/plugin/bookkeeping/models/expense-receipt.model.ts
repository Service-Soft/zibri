import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * The document of an expense, such as the pdf of an invoice received or the scan of a receipt, archived unchanged for
 * the `receiptRetention` of the bookkeeping plugin, counted from the end of the year it was uploaded in.
 */
// the retention here is the default of the plugin, which counts each row's retainUntil from its options instead
@Entity({ allowOrphan: true, chained: true })
@Archive({ retention: { years: 8 }, dateProperty: 'uploadedAt' })
export class ExpenseReceipt extends BaseArchivedEntity {
    /**
     * The tenant the receipt belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The file, kept in the file store `receiptStore` of the bookkeeping plugin options names, `receipts` by default.
     */
    @Property.file({
        store: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.RECEIPT_FILE_STORE,
        allowedMimeTypes: 'all',
        maxSize: BookkeepingLimits.RECEIPT_MAX_SIZE
    })
    file!: string;

    /**
     * When the receipt was uploaded.
     */
    @Property.date()
    uploadedAt!: Date;

    /**
     * The user who uploaded the receipt, or null when no user did.
     */
    @Property.string({ required: false })
    uploadedBy?: string | null;
}
