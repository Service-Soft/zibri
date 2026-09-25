declare const xmlStringBrand: unique symbol;

/**
 * Text that is a well formed xml document.
 *
 * Written by `XmlUtilities.generateFrom`, or checked by `XmlUtilities.resolveXmlString`. Well formed says that the
 * text is xml, not that it fits a model: `XmlUtilities.parseFrom` is what checks that.
 */
export type XmlString = string & {
    /**
     * Tells an xml document apart from other text while compiling. Nothing holds it at runtime.
     */
    readonly [xmlStringBrand]: true
};