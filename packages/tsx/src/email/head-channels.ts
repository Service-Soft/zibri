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
    attributes: string
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
    attributes: 'mjAttributes'
} as const;