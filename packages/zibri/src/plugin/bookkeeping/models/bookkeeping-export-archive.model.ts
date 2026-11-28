import { type MimeType } from '../../../http/mime-type.enum';

/**
 * The archive of the export of a fiscal year, written while it is read.
 */
export type BookkeepingExportArchive = {
    /**
     * The name of the file, such as `gobd-export-2026.zip`.
     */
    fileName: `${string}.${string}`,
    /**
     * The mime type of the file, such as `application/zip`.
     */
    mimeType: MimeType,
    /**
     * The bytes of the archive, read once.
     */
    content: AsyncIterable<Buffer>
};