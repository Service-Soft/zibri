import { AccordionPassedAttributes, AccordionSettings } from './accordion.context';
import { resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import type { MjAccordionTextProps } from './mj-accordion-text';
import type { MjAccordionTitleProps } from './mj-accordion-title';
import { isScriptUrl } from '../runtime/server-runtime';

/**
 * Builds the title and the text of an accordion element, which an element without one of them writes empty, as MJML
 * does.
 */
export abstract class AccordionMarkupUtilities {
    /**
     * The title of an element, beside the icons opening and closing it. Mirrors MJML's `mj-accordion-title`.
     * @param p - The title's props, with their defaults.
     * @param settings - What the title takes from around it.
     * @param content - The rendered title.
     * @returns The title.
     */
    static resolveTitle(p: MjAccordionTitleProps, settings: AccordionSettings | undefined, content: string): string {
        const passed: AccordionPassedAttributes = settings?.passed ?? {};
        const titleStyle: string = EmailMarkupUtilities.resolveStyle({
            width: '100%',
            'background-color': p.backgroundColor,
            color: p.color,
            'font-size': p.fontSize ?? '13px',
            'font-family': p.fontFamily ?? settings?.elementFontFamily ?? settings?.accordionFontFamily,
            'font-weight': p.fontWeight,
            padding: resolvePaddingOf(p, '16px')
        });
        const title: string = `<td${EmailMarkupUtilities.resolveAttributes({ class: p.cssClass })} style="${titleStyle}">${content}</td>`;
        const icon: string = EmailMarkupUtilities.resolveStyle({ display: 'none', width: passed.iconWidth, height: passed.iconHeight });
        const icons: string = EmailMarkupUtilities.resolveOutlookConditional(
            `<td class="mj-accordion-ico" style="${EmailMarkupUtilities.resolveStyle({
                padding: '16px',
                background: p.backgroundColor,
                'vertical-align': passed.iconAlign
            })}">`
            + `<img${EmailMarkupUtilities.resolveAttributes({
                src: this.safeUrl(passed.iconWrappedUrl),
                alt: passed.iconWrappedAlt,
                class: 'mj-accordion-more',
                style: icon
            })} />`
            + `<img${EmailMarkupUtilities.resolveAttributes({
                src: this.safeUrl(passed.iconUnwrappedUrl),
                alt: passed.iconUnwrappedAlt,
                class: 'mj-accordion-less',
                style: icon
            })} />`
            + '</td>',
            true
        );
        return '<div class="mj-accordion-title">'
            + `<table cellspacing="0" cellpadding="0" style="${this.borderBottom(passed)}"><tbody><tr>`
            + (passed.iconPosition === 'right' ? title + icons : icons + title)
            + '</tr></tbody></table></div>';
    }

    /**
     * The text of an element, which opening it shows. Mirrors MJML's `mj-accordion-text`.
     * @param p - The text's props, with their defaults.
     * @param settings - What the text takes from around it.
     * @param content - The rendered text.
     * @returns The text.
     */
    static resolveText(p: MjAccordionTextProps, settings: AccordionSettings | undefined, content: string): string {
        const passed: AccordionPassedAttributes = settings?.passed ?? {};
        return '<div class="mj-accordion-content">'
            + `<table cellspacing="0" cellpadding="0" style="${this.borderBottom(passed)}"><tbody><tr>`
            + `<td${EmailMarkupUtilities.resolveAttributes({ class: p.cssClass })} style="${EmailMarkupUtilities.resolveStyle({
                background: p.backgroundColor,
                'font-size': p.fontSize ?? '13px',
                'font-family': p.fontFamily ?? settings?.elementFontFamily ?? settings?.accordionFontFamily,
                'font-weight': p.fontWeight,
                'letter-spacing': p.letterSpacing,
                'line-height': p.lineHeight ?? '1',
                color: p.color,
                padding: resolvePaddingOf(p, '16px')
            })}">${content}</td>`
            + '</tr></tbody></table></div>';
    }

    private static borderBottom(passed: AccordionPassedAttributes): string {
        return EmailMarkupUtilities.resolveStyle({ width: '100%', 'border-bottom': passed.border });
    }

    private static safeUrl(url: string | undefined): string | undefined {
        return url == undefined || isScriptUrl(url) ? undefined : url;
    }
}