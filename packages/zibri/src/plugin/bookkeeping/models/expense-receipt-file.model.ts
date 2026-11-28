/**
 * The document of an expense to keep, as `createReceipt` of the expense service takes it.
 */
export type ExpenseReceiptFile = {
    /**
     * The name the file is kept under, such as `invoice-2026-117.pdf`.
     */
    name: string,
    /**
     * The mime type of the file, such as `application/pdf`.
     */
    mimeType: string,
    /**
     * The bytes of the file.
     */
    data: Buffer,
    /**
     * The user who uploads it. None by default.
     */
    uploadedBy?: string | null
};