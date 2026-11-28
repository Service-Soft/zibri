/**
 * What the export of a fiscal year holds beside its tables, as `GET /bookkeeping/fiscal-years/:id/export` takes it in
 * its query.
 */
export type BookkeepingExportOptionsModel = {
    /**
     * Whether the documents the rows name are in the export: the pdfs and xml archived at the issue of the invoices,
     * the receipts of the expenses, the files of the bank statements and the statements archived at the closing of the
     * fiscal year. True by default.
     */
    documents?: boolean
};
