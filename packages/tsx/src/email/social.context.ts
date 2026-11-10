import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * The attributes an `MjSocial` passes each of its elements, which an element's own props win over.
 */
export type SocialPassedAttributes = {
    /**
     * Padding around the element.
     */
    padding?: string,
    /**
     * The border of the icon.
     */
    border?: string,
    /**
     * The border radius of the icon.
     */
    borderRadius?: string,
    /**
     * Text color.
     */
    color?: string,
    /**
     * Font stack.
     */
    fontFamily?: string,
    /**
     * Font size.
     */
    fontSize?: string,
    /**
     * Font weight.
     */
    fontWeight?: string,
    /**
     * Font style.
     */
    fontStyle?: string,
    /**
     * The width of the icon.
     */
    iconSize?: string,
    /**
     * The height of the icon.
     */
    iconHeight?: string,
    /**
     * Padding around the icon.
     */
    iconPadding?: string,
    /**
     * Padding around the text.
     */
    textPadding?: string,
    /**
     * Line height.
     */
    lineHeight?: string,
    /**
     * Text decoration.
     */
    textDecoration?: string
};

/**
 * What a social element takes from the `MjSocial` it is in.
 */
export type SocialSettings = {
    /**
     * How the elements are laid out.
     */
    mode: 'horizontal' | 'vertical',
    /**
     * The alignment of the `MjSocial`.
     */
    align: string,
    /**
     * The attributes passed to each element.
     */
    passed: SocialPassedAttributes
};

/**
 * The `MjSocial` a social element is in, or undefined for one rendered on its own.
 */
export const SocialContext: RenderContext<SocialSettings | undefined> = createContext<SocialSettings | undefined>(undefined);