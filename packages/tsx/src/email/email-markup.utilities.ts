import { randomBytes } from 'node:crypto';

/**
 * Values of a style or of the attributes of an element, by name. An undefined value is left out.
 */
export type EmailMarkupValues = Record<string, string | number | undefined>;

/**
 * The cell a column wraps each of its content components in.
 */
export type EmailRowCell = {
    /**
     * The horizontal alignment of the cell.
     */
    align?: string,
    /**
     * A CSS class of the cell.
     */
    cssClass?: string,
    /**
     * The background of the cell.
     */
    containerBackgroundColor?: string,
    /**
     * The padding of the cell.
     */
    padding?: string
};

/**
 * Builds the markup the email components share, the way MJML writes it. Every value handed in is written as it is,
 * so it is escaped by whoever read it from the props.
 */
export abstract class EmailMarkupUtilities {
    /**
     * An inline style, each declaration ended by a `;`.
     * @param declarations - The declarations, by property.
     * @returns The style.
     */
    static resolveStyle(declarations: EmailMarkupValues): string {
        return Object.entries(declarations)
            .filter(([, value]) => value !== undefined)
            .map(([property, value]) => `${property}:${value};`)
            .join('');
    }

    /**
     * Attributes, each with a leading space.
     * @param attributes - The attributes, by name.
     * @returns The attributes.
     */
    static resolveAttributes(attributes: EmailMarkupValues): string {
        return Object.entries(attributes)
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => ` ${name}="${value}"`)
            .join('');
    }

    /**
     * The row a column puts a content component in. Mirrors the cell MJML's `mj-column` wraps each child in.
     * @param cell - The cell's alignment, class, background and padding.
     * @param content - The component's own markup.
     * @returns The row.
     */
    static resolveRow(cell: EmailRowCell, content: string): string {
        const attributes: string = this.resolveAttributes({ align: cell.align, class: cell.cssClass });
        const style: string = this.resolveStyle({
            background: cell.containerBackgroundColor,
            'font-size': '0px',
            padding: cell.padding,
            'word-break': 'break-word'
        });
        return `<tr><td${attributes} style="${style}">${content}</td></tr>`;
    }

    /**
     * Markup only Outlook and old Internet Explorer read, or, negated, markup only they skip.
     * @param content - The markup.
     * @param negation - Whether every other client reads it instead.
     * @returns The conditional comment holding it.
     */
    static resolveOutlookConditional(content: string, negation: boolean = false): string {
        return negation ? `<!--[if !mso | IE]><!-->${content}<!--<![endif]-->` : `<!--[if mso | IE]>${content}<![endif]-->`;
    }

    /**
     * Markup only Outlook reads, or, negated, markup only Outlook skips.
     * @param content - The markup.
     * @param negation - Whether every other client reads it instead.
     * @returns The conditional comment holding it.
     */
    static resolveMsoConditional(content: string, negation: boolean = false): string {
        return negation ? `<!--[if !mso]><!-->${content}<!--<![endif]-->` : `<!--[if mso]>${content}<![endif]-->`;
    }

    /**
     * Each of a list of classes with a suffix, as MJML names the classes of a part of a component.
     * @param classes - The classes, separated by spaces.
     * @param suffix - The suffix.
     * @returns The suffixed classes, or an empty string for none.
     */
    static suffixClasses(classes: string | undefined, suffix: string): string {
        return classes
            ? classes.split(' ').map(name => `${name}-${suffix}`)
                .join(' ')
            : '';
    }

    /**
     * A random id of 16 hex digits, which ties the inputs and labels of one component together the way MJML does.
     * @returns The id.
     */
    static resolveRandomId(): string {
        return randomBytes(8).toString('hex');
    }
}