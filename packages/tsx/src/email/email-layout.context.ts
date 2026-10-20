import { createContext, RenderContext } from '../runtime/server-runtime.ts';

/**
 * The layout values MJML flows down the tree: a section fixes the content width its columns lay out
 * within, and inherited typography defaults so nested text does not repeat them. A component reads
 * this to lay itself out and can override any part for its own subtree.
 */
export type EmailLayout = {
    /**
     * The content width of the current section, e.g. `600px`. Columns size themselves against it.
     */
    width: string,
    /**
     * The text direction.
     */
    dir: 'ltr' | 'rtl',
    /**
     * The horizontal alignment inherited by content.
     */
    textAlign: 'left' | 'center' | 'right' | 'justify',
    /**
     * The inherited text color.
     */
    color: string,
    /**
     * The inherited font stack.
     */
    fontFamily: string,
    /**
     * The inherited line height.
     */
    lineHeight: number
};

/**
 * The inherited email layout. Its defaults match MJML's: a 600px body, left-to-right, centered, in
 * Ubuntu on black. Provided by the section (width) and the document (typography), read by columns
 * and content components.
 */
export const EmailLayoutContext: RenderContext<EmailLayout> = createContext<EmailLayout>({
    width: '600px',
    dir: 'ltr',
    textAlign: 'center',
    color: '#000000',
    fontFamily: 'Ubuntu, Helvetica, Arial, sans-serif',
    lineHeight: 1
});