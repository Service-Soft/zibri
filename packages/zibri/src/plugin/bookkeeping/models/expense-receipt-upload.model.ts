import { Property } from '../../../entity/decorators/property.decorator';
import { File } from '../../../parsing/form-data/file.model';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * The document of an expense, as `POST /expense-receipts` of the `BookkeepingController` takes it in a multipart body.
 */
export class ExpenseReceiptUpload {
    /**
     * The file.
     */
    // of any mime type: a receipt is a pdf, an image or an e-invoice, whatever the system of the browser calls it
    @Property.file({ allowedMimeTypes: 'all', maxSize: BookkeepingLimits.RECEIPT_MAX_SIZE })
    file!: File;
}
