/**
 * How a model appears as the root element of an xml document.
 */
export type XmlRootMetadata = {
    /**
     * The name of the root element.
     */
    name: string,
    /**
     * The namespace of the root element, and of every model in the document that names none of its own.
     */
    namespace: string | undefined,
    /**
     * The prefixes the document declares, each with the namespace it stands for.
     */
    prefixes: Record<string, string>
};

/**
 * What `@XmlRoot` is given.
 */
export type XmlRootMetadataInput = Partial<XmlRootMetadata>;