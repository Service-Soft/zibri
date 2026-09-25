/**
 * How `XmlUtilities.parseFrom` reads a document.
 */
export type XmlParseOptions = {
    /**
     * Whether the root element may hold elements its model does not declare. Defaults to false, which reports each
     * of them as an unknown key. A model further down allows them with `allowAdditionalProperties` on the property
     * that holds it.
     */
    allowAdditionalProperties?: boolean
};