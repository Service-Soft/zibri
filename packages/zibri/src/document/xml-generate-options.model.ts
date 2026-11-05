/**
 * How `XmlUtilities.generateFrom` writes a document.
 */
export type XmlGenerateOptions = {
    /**
     * Whether an element that holds only other elements puts each of them on a line of its own, indented by two
     * spaces. Text, and an element holding text, stays exactly as it is, so nothing a reader of the document gets
     * changes. Defaults to false, which writes the document on one line.
     */
    indent?: boolean
};