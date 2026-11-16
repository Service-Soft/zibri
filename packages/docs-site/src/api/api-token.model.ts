import type { CodeTokenKind } from 'zibri-mdx';

/**
 * A piece of the code the API reference prints, such as a type or a signature.
 */
export type ApiToken = {
    text: string,
    // the kind it is colored as, the class of a highlighted code block; none for plain text
    kind?: CodeTokenKind,
    // where it leads, for the name of an export
    href?: string
};