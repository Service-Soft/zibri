/**
 * A font an `MjFont` declares, as it is recorded.
 */
export type EmailFont = {
    /**
     * The name the font is used by in a `font-family`.
     */
    name: string,
    /**
     * The url of its stylesheet.
     */
    href: string
};

/**
 * An attribute an `MjHtmlAttribute` sets on the elements a selector matches, as it is recorded.
 */
export type EmailHtmlAttribute = {
    /**
     * The CSS selector.
     */
    path: string,
    /**
     * The attribute's name.
     */
    name: string,
    /**
     * The attribute's value, escaped.
     */
    value: string
};