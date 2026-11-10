import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * The attributes an `MjAccordion` passes its elements, and an element passes its title and text, each the
 * element's own when it sets them.
 */
export type AccordionPassedAttributes = {
    /**
     * The border between the parts.
     */
    border?: string,
    /**
     * Vertical alignment of the icon.
     */
    iconAlign?: string,
    /**
     * The width of the icon.
     */
    iconWidth?: string,
    /**
     * The height of the icon.
     */
    iconHeight?: string,
    /**
     * Whether the icon is `left` or `right` of the title.
     */
    iconPosition?: string,
    /**
     * The url of the icon while the element is closed.
     */
    iconWrappedUrl?: string,
    /**
     * The alternative text of the icon while the element is closed.
     */
    iconWrappedAlt?: string,
    /**
     * The url of the icon while the element is open.
     */
    iconUnwrappedUrl?: string,
    /**
     * The alternative text of the icon while the element is open.
     */
    iconUnwrappedAlt?: string
};

/**
 * What a part of an accordion takes from around it.
 */
export type AccordionSettings = {
    /**
     * The attributes passed to it.
     */
    passed: AccordionPassedAttributes,
    /**
     * The font stack of the accordion.
     */
    accordionFontFamily?: string,
    /**
     * The font stack of the element, which wins over the accordion's.
     */
    elementFontFamily?: string,
    /**
     * Which parts the element holds, which each title and text records as it renders.
     */
    parts: AccordionParts
};

/**
 * Which parts an accordion element holds.
 */
export type AccordionParts = {
    /**
     * Whether it holds a title.
     */
    title: boolean,
    /**
     * Whether it holds a text.
     */
    text: boolean
};

/**
 * The accordion and the element a part is in, or undefined for one rendered on its own.
 */
export const AccordionContext: RenderContext<AccordionSettings | undefined> = createContext<AccordionSettings | undefined>(undefined);