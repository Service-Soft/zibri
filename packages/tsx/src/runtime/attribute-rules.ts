// What decides how an attribute is written, shared by the server, which renders it, and the page, whose bindings
// write it again when a state changes: the two have to agree for every value.

/**
 * JSX prop names that map to a different HTML attribute name.
 */
export const ATTRIBUTE_NAME_MAP: Readonly<Record<string, string>> = {
    className: 'class',
    htmlFor: 'for'
};

/**
 * The names an attribute is rendered under: letters, digits and `_ : . -`, starting with a letter,
 * `_` or `:`.
 */
export const ATTRIBUTE_NAME: RegExp = /^[:A-Z_a-z][\w.:-]*$/;

/**
 * The attributes whose value a browser follows as a url, lower case.
 */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
    'href',
    'src',
    'action',
    'formaction',
    'xlink:href',
    'xlinkhref',
    'poster',
    'cite',
    'background',
    'data'
]);