import { AccordionMarkupUtilities } from './accordion-markup.utilities';
import { AccordionContext, AccordionParts, AccordionPassedAttributes, AccordionSettings } from './accordion.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjAccordionElement}.
 */
export type MjAccordionElementProps = {
    /**
     * Background color of the element.
     */
    backgroundColor?: string,
    /**
     * The border between its title and its text, the accordion's when unset.
     */
    border?: string,
    /**
     * Font stack of its title and its text, the accordion's when unset.
     */
    fontFamily?: string,
    /**
     * Vertical alignment of the icon, the accordion's when unset.
     */
    iconAlign?: 'top' | 'middle' | 'bottom',
    /**
     * The width of the icon, the accordion's when unset.
     */
    iconWidth?: string,
    /**
     * The height of the icon, the accordion's when unset.
     */
    iconHeight?: string,
    /**
     * Whether the icon is `left` or `right` of the title, the accordion's when unset.
     */
    iconPosition?: 'left' | 'right',
    /**
     * The url of the icon while the element is closed, the accordion's when unset.
     */
    iconWrappedUrl?: string,
    /**
     * The alternative text of the icon while the element is closed, the accordion's when unset.
     */
    iconWrappedAlt?: string,
    /**
     * The url of the icon while the element is open, the accordion's when unset.
     */
    iconUnwrappedUrl?: string,
    /**
     * The alternative text of the icon while the element is open, the accordion's when unset.
     */
    iconUnwrappedAlt?: string,
    /**
     * A CSS class added to the element's row.
     */
    cssClass?: string
};

/**
 * One part of an accordion, a title that opens and closes a text. Mirrors MJML's `mj-accordion-element`: a checkbox
 * no client but Outlook sees, which CSS in the head opens the text with. An element without an `MjAccordionTitle`
 * or an `MjAccordionText` gets an empty one.
 */
export const MjAccordionElement: TsxComponent<MjAccordionElementProps> = defineEmailComponent<MjAccordionElementProps>(
    'MjAccordionElement',
    (props, $ssr) => {
        const p: MjAccordionElementProps = withDefaults($ssr, 'MjAccordionElement', props);
        const accordion: AccordionSettings | undefined = $ssr.useContext(AccordionContext);
        const inherited: AccordionPassedAttributes = accordion?.passed ?? {};
        const passed: AccordionPassedAttributes = {
            border: p.border ?? inherited.border,
            iconAlign: p.iconAlign ?? inherited.iconAlign,
            iconWidth: p.iconWidth ?? inherited.iconWidth,
            iconHeight: p.iconHeight ?? inherited.iconHeight,
            iconPosition: p.iconPosition ?? inherited.iconPosition,
            iconWrappedUrl: p.iconWrappedUrl ?? inherited.iconWrappedUrl,
            iconWrappedAlt: p.iconWrappedAlt ?? inherited.iconWrappedAlt,
            iconUnwrappedUrl: p.iconUnwrappedUrl ?? inherited.iconUnwrappedUrl,
            iconUnwrappedAlt: p.iconUnwrappedAlt ?? inherited.iconUnwrappedAlt
        };
        const parts: AccordionParts = { title: false, text: false };
        const settings: AccordionSettings = {
            passed,
            accordionFontFamily: accordion?.accordionFontFamily,
            elementFontFamily: p.fontFamily,
            parts
        };
        $ssr.provideContext(AccordionContext, settings);
        const children: string = $ssr.child(props.children);
        const content: string = (parts.title ? '' : AccordionMarkupUtilities.resolveTitle({}, settings, ''))
            + children
            + (parts.text ? '' : AccordionMarkupUtilities.resolveText({}, settings, ''));

        const cellStyle: string = EmailMarkupUtilities.resolveStyle({ padding: '0px', 'background-color': p.backgroundColor });
        const labelStyle: string = EmailMarkupUtilities.resolveStyle({ 'font-size': '13px', 'font-family': p.fontFamily });
        const checkbox: string = '<input class="mj-accordion-checkbox" type="checkbox" style="display:none;" />';

        return $ssr.raw(
            `<tr${EmailMarkupUtilities.resolveAttributes({ class: p.cssClass })}>`
            + `<td style="${cellStyle}">`
            + `<label class="mj-accordion-element" style="${labelStyle}">`
            + EmailMarkupUtilities.resolveOutlookConditional(checkbox, true)
            + `<div>${content}</div></label></td></tr>`
        );
    }
);