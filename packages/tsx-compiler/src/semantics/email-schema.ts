/**
 * The subpath the framework's MJML components are exported from directly.
 */
export const EMAIL_MODULE: string = 'zibri-tsx/email';

/**
 * The main framework package, which re-exports the email components so a template can import
 * everything from one place. An email component is recognized from here by its known name.
 */
export const ZIBRI_MODULE: string = 'zibri';

/**
 * What kind of children an email component accepts, grounded in what it actually renders.
 * - `structural`: only the email components in its `children` list (a body holds sections, etc.);
 * raw HTML and text are not allowed, they belong in a content component.
 * - `content`: arbitrary text and HTML, but no email components (a text block, a button label).
 * - `text`: text only, no elements at all (a title, a preview line, a style block).
 * - `empty`: no children at all (an image, a divider, a spacer - they render from props alone).
 */
export type EmailComponentKind = 'structural' | 'content' | 'text' | 'empty';

/**
 * An email component's nesting contract.
 */
export type EmailComponentSchema = {
    /**
     * The kind of children it accepts.
     */
    kind: EmailComponentKind,
    /**
     * The email components it may directly contain (only meaningful for `structural`).
     */
    children: readonly string[]
};

/**
 * The components MJML lets a column, and a hero, hold.
 */
const COLUMN_CONTENT: readonly string[] = [
    'MjAccordion',
    'MjButton',
    'MjCarousel',
    'MjDivider',
    'MjImage',
    'MjNavbar',
    'MjRaw',
    'MjSocial',
    'MjSpacer',
    'MjTable',
    'MjText'
];

/**
 * The nesting contract of every framework email component, by canonical (exported) name. This is
 * MJML's structure, expressed as data: the lists are those of `mjml-preset-core`.
 *
 * Non-email children - user components, expressions, whitespace - are handled by the validator, not
 * this table: a user component is judged by what it renders, and expressions are transparent control
 * flow.
 */
export const EMAIL_COMPONENTS: Readonly<Record<string, EmailComponentSchema>> = {
    Mjml: { kind: 'structural', children: ['MjHead', 'MjBody', 'MjRaw'] },
    MjHead: {
        kind: 'structural',
        children: ['MjAttributes', 'MjBreakpoint', 'MjFont', 'MjHtmlAttributes', 'MjPreview', 'MjRaw', 'MjStyle', 'MjTitle']
    },
    MjBody: { kind: 'structural', children: ['MjHero', 'MjRaw', 'MjSection', 'MjWrapper'] },
    MjWrapper: { kind: 'structural', children: ['MjHero', 'MjRaw', 'MjSection'] },
    MjSection: { kind: 'structural', children: ['MjColumn', 'MjGroup', 'MjRaw'] },
    MjGroup: { kind: 'structural', children: ['MjColumn', 'MjRaw'] },
    MjColumn: { kind: 'structural', children: COLUMN_CONTENT },
    MjHero: { kind: 'structural', children: COLUMN_CONTENT },
    MjAccordion: { kind: 'structural', children: ['MjAccordionElement', 'MjRaw'] },
    MjAccordionElement: { kind: 'structural', children: ['MjAccordionText', 'MjAccordionTitle', 'MjRaw'] },
    MjCarousel: { kind: 'structural', children: ['MjCarouselImage'] },
    MjNavbar: { kind: 'structural', children: ['MjNavbarLink', 'MjRaw'] },
    MjSocial: { kind: 'structural', children: ['MjRaw', 'MjSocialElement'] },
    MjHtmlAttributes: { kind: 'structural', children: ['MjSelector'] },
    MjSelector: { kind: 'structural', children: ['MjHtmlAttribute'] },
    MjText: { kind: 'content', children: [] },
    MjButton: { kind: 'content', children: [] },
    MjRaw: { kind: 'content', children: [] },
    MjTable: { kind: 'content', children: [] },
    MjAccordionTitle: { kind: 'content', children: [] },
    MjAccordionText: { kind: 'content', children: [] },
    MjNavbarLink: { kind: 'content', children: [] },
    MjSocialElement: { kind: 'content', children: [] },
    MjTitle: { kind: 'text', children: [] },
    MjPreview: { kind: 'text', children: [] },
    MjStyle: { kind: 'text', children: [] },
    MjHtmlAttribute: { kind: 'text', children: [] },
    MjImage: { kind: 'empty', children: [] },
    MjDivider: { kind: 'empty', children: [] },
    MjSpacer: { kind: 'empty', children: [] },
    MjCarouselImage: { kind: 'empty', children: [] },
    MjAttributes: { kind: 'empty', children: [] },
    MjBreakpoint: { kind: 'empty', children: [] },
    MjFont: { kind: 'empty', children: [] }
};

/**
 * The nesting contract of an email component, or undefined when the name is not one.
 * @param name - The canonical component name.
 * @returns The schema, or undefined.
 */
export function emailSchema(name: string): EmailComponentSchema | undefined {
    return Object.prototype.hasOwnProperty.call(EMAIL_COMPONENTS, name) ? EMAIL_COMPONENTS[name] : undefined;
}