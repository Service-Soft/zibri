/**
 * An exporter of the E-Bilanz, a format it can be downloaded in to be filed by hand.
 */
export type EBilanzExporterModel = {
    /**
     * The name of the exporter, which an export names.
     */
    name: string,
    /**
     * The mime type of the file it writes.
     */
    mimeType: string,
    /**
     * The extension of the file it writes, such as `xbrl`.
     */
    fileExtension: string
};
