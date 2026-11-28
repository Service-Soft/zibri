/**
 * How `XmlUtilities.generateFrom` writes a document.
 */
export type XmlGenerateOptions = {
    /**
     * Whether an element that holds only other elements puts each of them on a line of its own, indented by two
     * spaces. Text, and an element holding text, stays exactly as it is, so nothing a reader of the document gets
     * changes. Defaults to false, which writes the document on one line.
     */
    indent?: boolean,
    /**
     * The file of the document type definition the document names after its xml declaration, written as
     * `<!DOCTYPE Root SYSTEM "file">` with the name of its root element, such as `gdpdu-01-09-2004.dtd`. None by
     * default.
     */
    doctypeSystemId?: string
};