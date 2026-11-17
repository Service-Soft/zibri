/**
 * The named collect channels the email head is assembled from.
 */
export type HeadChannels = {
    /**
     * Column width percentages, for the responsive rules.
     */
    columnWidth: string,
    /**
     * The document title.
     */
    title: string,
    /**
     * The inbox preview text.
     */
    preview: string,
    /**
     * Blocks of custom CSS.
     */
    style: string,
    /**
     * Serialized default-attribute declarations.
     */
    attributes: string,
    /**
     * The width below which columns stack.
     */
    breakpoint: string,
    /**
     * Serialized fonts the document may import.
     */
    font: string,
    /**
     * The names of the components whose shared styles the head carries.
     */
    componentStyle: string,
    /**
     * Blocks of CSS one component instance needs.
     */
    instanceStyle: string,
    /**
     * Raw markup placed in the head.
     */
    raw: string,
    /**
     * Raw markup placed before the doctype.
     */
    beforeDoctype: string,
    /**
     * Serialized attributes set on the elements a selector matches.
     */
    htmlAttribute: string
};

/**
 * The collect channels the email head is assembled from. A component deep in the tree records onto
 * one of these while it renders, and `Mjml` reads them back to build the head.
 */
export const HeadChannel: HeadChannels = {
    /**
     * The width percentage of each column used, for the responsive rules.
     */
    columnWidth: 'mjColumnWidth',
    /**
     * The document title.
     */
    title: 'mjTitle',
    /**
     * The inbox preview text.
     */
    preview: 'mjPreview',
    /**
     * Blocks of custom CSS.
     */
    style: 'mjStyle',
    /**
     * Serialized default-attribute declarations.
     */
    attributes: 'mjAttributes',
    /**
     * The width below which columns stack.
     */
    breakpoint: 'mjBreakpoint',
    /**
     * Serialized fonts the document may import.
     */
    font: 'mjFont',
    /**
     * The names of the components whose shared styles the head carries.
     */
    componentStyle: 'mjComponentStyle',
    /**
     * Blocks of CSS one component instance needs.
     */
    instanceStyle: 'mjInstanceStyle',
    /**
     * Raw markup placed in the head.
     */
    raw: 'mjRaw',
    /**
     * Raw markup placed before the doctype.
     */
    beforeDoctype: 'mjBeforeDoctype',
    /**
     * Serialized attributes set on the elements a selector matches.
     */
    htmlAttribute: 'mjHtmlAttribute'
} as const;