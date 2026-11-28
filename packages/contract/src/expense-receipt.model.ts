import { type ArchivedFileModel } from './archived-file.model';
import { type FileReference } from './file-reference.model';

/**
 * The document of an expense, archived unchanged for its retention, as `POST /bookkeeping/expense-receipts` answers it.
 */
export type ExpenseReceiptModel = {
    /**
     * The id of the receipt.
     */
    id: string,
    /**
     * The tenant the receipt belongs to.
     */
    tenantId: string,
    /**
     * The place of the receipt in the chain of the archived rows of its tenant.
     */
    chainSequence: number,
    /**
     * The hash linking the receipt to the row before it in its chain.
     */
    chainHash: string,
    /**
     * When the retention of the receipt ends, from which it may be deleted.
     */
    retainUntil: Date,
    /**
     * The file, with its SHA-256, as it was when it was uploaded.
     */
    archivedFiles: ArchivedFileModel[],
    /**
     * The file.
     */
    file: FileReference | null,
    /**
     * When the receipt was uploaded.
     */
    uploadedAt: Date,
    /**
     * The user who uploaded the receipt, or null when no user did.
     */
    uploadedBy?: string | null
};
