/**
 * What an element holds: its text and its child elements, in document order.
 */
export type XmlContent = string | XmlElementNode;

/**
 * One element of an xml document, with everything decoded.
 */
export type XmlElementNode = {
    /**
     * The name of the element, without its namespace prefix.
     */
    name: string,
    /**
     * The namespace the element is in, if any.
     */
    namespace: string | undefined,
    /**
     * The attributes of the element by their name, without their namespace prefix. An attribute of the `xml`
     * namespace keeps its prefix, eg. `xml:space`, since that prefix means the same in every document.
     */
    attributes: Record<string, string>,
    /**
     * The text and the child elements, in document order.
     */
    content: XmlContent[]
};