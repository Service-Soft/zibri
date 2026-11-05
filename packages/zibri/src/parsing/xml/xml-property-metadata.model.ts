/**
 * A property of a model that is a child element or an attribute of the model's element.
 */
export type NamedXmlPropertyMetadata = {
    /**
     * Whether the property is a child element or an attribute.
     */
    kind: 'element' | 'attribute',
    /**
     * The name of the element or attribute.
     */
    name: string
};

/**
 * A property of a model that is the text of the model's element.
 */
export type TextXmlPropertyMetadata = {
    /**
     * Marks the property as the element's own text.
     */
    kind: 'text'
};

/**
 * A property of a model that is everything inside the model's element: its text and its child elements, in order.
 */
export type MixedXmlPropertyMetadata = {
    /**
     * Marks the property as the element's mixed content.
     */
    kind: 'mixed'
};

/**
 * How a property of a model appears in xml.
 */
export type XmlPropertyMetadata = NamedXmlPropertyMetadata | TextXmlPropertyMetadata | MixedXmlPropertyMetadata;