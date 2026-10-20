import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { HeadChannel } from './head-channels.ts';

/**
 * Props for {@link Mjml}.
 */
export type MjmlProps = {
    /**
     * The document title, placed in the head. An `MjTitle` in the head overrides it.
     */
    title?: string,
    /**
     * The document language, e.g. `en`. Defaults to `und` (undetermined), as MJML does.
     */
    lang?: string,
    /**
     * The base text direction. Defaults to `auto`.
     */
    dir?: 'auto' | 'ltr' | 'rtl'
};

/**
 * The hidden block that carries the inbox preview text, emitted at the start of the body.
 */
const PREVIEW_STYLE: string = 'display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;'
    + 'max-width:0px;opacity:0;overflow:hidden;';

/**
 * The reset styles and Outlook office settings every email shares, before the responsive rules.
 */
const HEAD_PREFIX: string = '<!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]-->'
    + '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style type="text/css">'
    + '#outlook a { padding:0; }'
    + 'body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }'
    + 'table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }'
    + 'img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }'
    + 'p { display:block;margin:13px 0; }'
    + '</style>'
    + '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/>'
    + '<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->'
    + '<!--[if lte mso 11]><style type="text/css">.mj-outlook-group-fix { width:100% !important; }</style><![endif]-->';

/**
 * The Ubuntu font import MJML emits by default, hidden from Outlook.
 */
const FONTS: string = '<!--[if !mso]><!-->'
    + '<link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">'
    + '<style type="text/css">@import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);</style>'
    + '<!--<![endif]-->';

/**
 * Escapes the characters that must not appear literally in an HTML attribute or text.
 * @param value - The raw value.
 * @returns The escaped value.
 */
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/**
 * The responsive rules MJML emits for the column widths a body actually used: at desktop each column
 * keeps its width, and the default (mobile) makes it full width, so columns stack. Nothing is emitted
 * when no columns were rendered.
 * @param widths - The distinct column width percentages the body registered.
 * @returns The two style blocks, or an empty string.
 */
function mediaQueries(widths: string[]): string {
    if (widths.length === 0) {
        return '';
    }
    const rule: (prefix: string) => string = (prefix: string) => widths
        .map(width => `${prefix}.mj-column-per-${width} { width:${width}% !important; max-width: ${width}%; }`)
        .join('');

    return `<style type="text/css">@media only screen and (min-width:480px) {${rule('')}}</style>`
        + `<style media="screen and (min-width:480px)">${rule('.moz-text-html ')}</style>`;
}

/**
 * The root of an email document. Mirrors MJML's `mjml`: the doctype, `html`, head and `body` wrapper
 * the rest of the tree renders inside.
 *
 * The body is rendered before the head is built, so the responsive rules can be limited to the column
 * widths the body actually used - MJML's two-pass, expressed as reading back what the children
 * collected while they rendered.
 */
export const Mjml: TsxComponent<MjmlProps> = defineEmailComponent<MjmlProps>('Mjml', (props, $ssr) => {
    const lang: string = props.lang ?? 'und';
    const dir: string = props.dir ?? 'auto';
    const body: string = $ssr.child(props.children);
    const title: string = $ssr.collected(HeadChannel.title)[0] ?? props.title ?? '';
    const customStyles: string = $ssr.collected(HeadChannel.style)
        .map(css => `<style type="text/css">${css}</style>`)
        .join('');
    const head: string = `<title>${escapeHtml(title)}</title>`
        + HEAD_PREFIX
        + FONTS
        + mediaQueries($ssr.collected(HeadChannel.columnWidth))
        + customStyles;

    const preview: string = $ssr.collected(HeadChannel.preview)
        .map(text => `<div style="${PREVIEW_STYLE}">${escapeHtml(text)}</div>`)
        .join('');

    return $ssr.raw(
        '<!doctype html>'
        + `<html lang="${lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" `
        + 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
        + `<head>${head}</head>`
        + '<body style="word-spacing:normal;">'
        + preview
        + body
        + '</body></html>'
    );
});