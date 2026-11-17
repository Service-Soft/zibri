import { AccordionContext, AccordionPassedAttributes } from './accordion.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { HeadChannel } from './head-channels';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjAccordion}.
 */
export type MjAccordionProps = EmailPaddingProps & {
    /**
     * Background color of the surrounding cell.
     */
    containerBackgroundColor?: string,
    /**
     * The border of the accordion and between its parts. Defaults to `2px solid black`.
     */
    border?: string,
    /**
     * Font stack of its titles and texts. Defaults to `Ubuntu, Helvetica, Arial, sans-serif`.
     */
    fontFamily?: string,
    /**
     * Vertical alignment of the icons. Defaults to `middle`.
     */
    iconAlign?: 'top' | 'middle' | 'bottom',
    /**
     * The width of the icons. Defaults to `32px`.
     */
    iconWidth?: string,
    /**
     * The height of the icons. Defaults to `32px`.
     */
    iconHeight?: string,
    /**
     * Whether the icons are `left` or `right` of the titles. Defaults to `right`.
     */
    iconPosition?: 'left' | 'right',
    /**
     * The url of the icon of a closed element.
     */
    iconWrappedUrl?: string,
    /**
     * The alternative text of the icon of a closed element. Defaults to `+`.
     */
    iconWrappedAlt?: string,
    /**
     * The url of the icon of an open element.
     */
    iconUnwrappedUrl?: string,
    /**
     * The alternative text of the icon of an open element. Defaults to `-`.
     */
    iconUnwrappedAlt?: string,
    /**
     * A CSS class added to the surrounding cell.
     */
    cssClass?: string
};

/**
 * Parts that open and close, each a title over a text. Mirrors MJML's `mj-accordion`: a table of
 * `MjAccordionElement`s, which take the attributes it passes them unless they set their own.
 */
export const MjAccordion: TsxComponent<MjAccordionProps> = defineEmailComponent<MjAccordionProps>('MjAccordion', (props, $ssr) => {
    const p: MjAccordionProps = withDefaults($ssr, 'MjAccordion', props);
    const fontFamily: string = p.fontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif';
    const passed: AccordionPassedAttributes = {
        border: p.border ?? '2px solid black',
        iconAlign: p.iconAlign ?? 'middle',
        iconWidth: p.iconWidth ?? '32px',
        iconHeight: p.iconHeight ?? '32px',
        iconPosition: p.iconPosition ?? 'right',
        iconWrappedUrl: p.iconWrappedUrl ?? 'https://i.imgur.com/bIXv1bk.png',
        iconWrappedAlt: p.iconWrappedAlt ?? '+',
        iconUnwrappedUrl: p.iconUnwrappedUrl ?? 'https://i.imgur.com/w4uTygT.png',
        iconUnwrappedAlt: p.iconUnwrappedAlt ?? '-'
    };
    $ssr.collect(HeadChannel.componentStyle, 'MjAccordion');
    // an element records its own parts, so the accordion's are never read
    $ssr.provideContext(AccordionContext, { passed, accordionFontFamily: fontFamily, parts: { title: false, text: false } });
    const table: string = `<table cellspacing="0" cellpadding="0" class="mj-accordion" style="${EmailMarkupUtilities.resolveStyle({
        width: '100%',
        'border-collapse': 'collapse',
        border: passed.border,
        'border-bottom': 'none',
        'font-family': fontFamily
    })}"><tbody>${$ssr.child(props.children)}</tbody></table>`;

    return $ssr.raw(EmailMarkupUtilities.resolveRow({
        cssClass: p.cssClass,
        containerBackgroundColor: p.containerBackgroundColor,
        padding: resolvePaddingOf(p, '10px 25px')
    }, table));
});