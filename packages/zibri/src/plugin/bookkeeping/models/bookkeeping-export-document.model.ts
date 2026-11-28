import { type Readable } from 'node:stream';

/**
 * A document of the export of a fiscal year, such as the receipt of an expense, read unchanged from the archive.
 */
export type BookkeepingExportDocument = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    kind: 'document',
    /**
     * Its path in the export, which the row it belongs to names, such as
     * `documents/expense-receipts/0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90-rent.pdf`.
     */
    path: string,
    /**
     * Its bytes.
     */
    content: Readable
};