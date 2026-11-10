/**
 * What the search of the documentation finds: a page, or a section of one.
 */
export type DocsSearchEntry = {
    /**
     * The title of the page, or the heading of the section.
     */
    title: string,
    /**
     * Where it is, a section with its anchor.
     */
    address: string,
    /**
     * Where it is in the documentation: the folder of a page, the page of a section.
     */
    context: string,
    /**
     * Other words it is found by, from the frontmatter of a page.
     */
    keywords: string[]
};