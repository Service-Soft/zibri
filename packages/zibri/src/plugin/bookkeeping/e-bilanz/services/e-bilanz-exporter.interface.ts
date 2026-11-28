import { type MimeType } from '../../../../http/mime-type.enum';
import { type EBilanzContent } from '../models/e-bilanz-content.model';

/**
 * Writes an E-Bilanz as a file of one format, to be filed by hand, such as with another program. Provide each with
 * `E_BILANZ_EXPORTER_DI_VARIANT`, under a name of its own.
 */
export interface EBilanzExporterInterface {
    /**
     * The name an export names it by, such as `xbrl`.
     */
    readonly name: string,
    /**
     * The mime type of the file.
     */
    readonly mimeType: MimeType,
    /**
     * The extension of the file, such as `xbrl`.
     */
    readonly fileExtension: string,
    /**
     * Writes the file.
     * @param eBilanz - The content prepared.
     * @returns The file.
     */
    resolveFile: (eBilanz: EBilanzContent) => Buffer | Promise<Buffer>
}