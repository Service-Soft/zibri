import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, pixels, resolvePaddingOf, resolvePaddingSide } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { withDefaults } from './with-defaults';
import { isScriptUrl } from '../runtime/server-runtime';

/**
 * Props for {@link MjHero}.
 */
export type MjHeroProps = EmailPaddingProps & {
    /**
     * `fixed-height` keeps the hero at its `height`, `fluid-height` sizes it to the ratio of its background image.
     * Defaults to `fixed-height`.
     */
    mode?: 'fixed-height' | 'fluid-height',
    /**
     * The height of a `fixed-height` hero, padding included. Defaults to `0px`.
     */
    height?: string,
    /**
     * The url of the background image.
     */
    backgroundUrl?: string,
    /**
     * The width of the background image, which a `fluid-height` hero takes its ratio from.
     */
    backgroundWidth?: string,
    /**
     * The height of the background image, which a `fluid-height` hero takes its ratio from.
     */
    backgroundHeight?: string,
    /**
     * The CSS `background-position` of the image. Defaults to `center center`.
     */
    backgroundPosition?: string,
    /**
     * Background color, behind the image. Defaults to `#ffffff`.
     */
    backgroundColor?: string,
    /**
     * Border radius of the hero.
     */
    borderRadius?: string,
    /**
     * Background color of the content.
     */
    innerBackgroundColor?: string,
    /**
     * Padding around the content, inside the hero.
     */
    innerPadding?: string,
    /**
     * Overrides the top inner padding.
     */
    innerPaddingTop?: string,
    /**
     * Overrides the right inner padding.
     */
    innerPaddingRight?: string,
    /**
     * Overrides the bottom inner padding.
     */
    innerPaddingBottom?: string,
    /**
     * Overrides the left inner padding.
     */
    innerPaddingLeft?: string,
    /**
     * Vertical alignment of the content. Defaults to `top`.
     */
    verticalAlign?: 'top' | 'middle' | 'bottom',
    /**
     * A CSS class added to the hero.
     */
    cssClass?: string
};

/**
 * The cell of the hero holding its content, in the mode it is in.
 * @param p - The hero's props, with their defaults.
 * @param height - The height of a `fixed-height` hero without its padding.
 * @param content - The content.
 * @returns The cells of the hero's row.
 */
function heroCells(p: MjHeroProps, height: number, content: string): string {
    const backgroundUrl: string | undefined = p.backgroundUrl == undefined || isScriptUrl(p.backgroundUrl) ? undefined : p.backgroundUrl;
    const backgroundPosition: string = p.backgroundPosition ?? 'center center';
    const background: string = [
        p.backgroundColor ?? '#ffffff',
        ...backgroundUrl == undefined ? [] : [`url('${backgroundUrl}')`, 'no-repeat', `${backgroundPosition} / cover`]
    ].join(' ');
    const style: Record<string, string | undefined> = {
        background,
        'background-position': backgroundPosition,
        'background-repeat': 'no-repeat',
        'border-radius': p.borderRadius,
        padding: resolvePaddingOf(p, '0px'),
        'vertical-align': p.verticalAlign ?? 'top'
    };
    if (p.mode === 'fluid-height') {
        // MJML writes the ratio of an image whose size is not given as it computes it, NaN
        const backgroundHeight: number = Number.parseInt(p.backgroundHeight ?? '', 10);
        const backgroundWidth: number = Number.parseInt(p.backgroundWidth ?? '', 10);
        const ratio: number = Math.round((backgroundHeight / backgroundWidth) * 100);
        const fluidStyle: string = EmailMarkupUtilities.resolveStyle({
            width: '0.01%',
            'padding-bottom': `${ratio}%`,
            'mso-padding-bottom-alt': '0'
        });
        const fluid: string = `<td style="${fluidStyle}" />`;
        return `${fluid}<td${EmailMarkupUtilities.resolveAttributes({ background: backgroundUrl })} `
            + `style="${EmailMarkupUtilities.resolveStyle(style)}">${content}</td>${fluid}`;
    }
    const cellHeight: string = `${height}px`;
    return `<td${EmailMarkupUtilities.resolveAttributes({ background: backgroundUrl })} `
        + `style="${EmailMarkupUtilities.resolveStyle({ ...style, height: cellHeight })}" height="${height}">${content}</td>`;
}

/**
 * A full-width band with a background image, holding content as a column does. Mirrors MJML's `mj-hero`: a ghost
 * table with an Outlook background image, and a centered table whose one row holds the content. The content lays
 * out within the body width less the hero's padding.
 */
export const MjHero: TsxComponent<MjHeroProps> = defineEmailComponent<MjHeroProps>('MjHero', (props, $ssr) => {
    const p: MjHeroProps = withDefaults($ssr, 'MjHero', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const containerWidth: number = pixels(layout.width);
    const padding: string = p.padding ?? '0px';
    const contentWidth: number = containerWidth
        - resolvePaddingSide(padding, 'left', p.paddingLeft)
        - resolvePaddingSide(padding, 'right', p.paddingRight);
    const height: number = Number.parseInt(p.height ?? '0px', 10)
        - resolvePaddingSide(padding, 'top', p.paddingTop)
        - resolvePaddingSide(padding, 'bottom', p.paddingBottom);
    const backgroundUrl: string | undefined = p.backgroundUrl == undefined || isScriptUrl(p.backgroundUrl) ? undefined : p.backgroundUrl;
    $ssr.provideContext(EmailLayoutContext, { ...layout, width: `${contentWidth}px` });
    const innerPadding: string | undefined = resolvePaddingOf({
        padding: p.innerPadding,
        paddingTop: p.innerPaddingTop,
        paddingRight: p.innerPaddingRight,
        paddingBottom: p.innerPaddingBottom,
        paddingLeft: p.innerPaddingLeft
    }, undefined);
    const innerTable: string = '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:0px;">';
    const content: string = EmailMarkupUtilities.resolveOutlookConditional(
        `<table border="0" cellpadding="0" cellspacing="0" style="width:${contentWidth}px;" width="${contentWidth}" ><tr>`
        + `<td style="${EmailMarkupUtilities.resolveStyle({ 'background-color': p.innerBackgroundColor, padding: innerPadding })}">`
    )
    + `<div class="mj-hero-content" style="${EmailMarkupUtilities.resolveStyle({
        'background-color': p.innerBackgroundColor,
        margin: '0px auto',
        padding: innerPadding
    })}">`
    + `${innerTable}<tbody><tr><td style="">${innerTable}<tbody>`
    + $ssr.child(props.children)
    + '</tbody></table></td></tr></tbody></table></div>'
    + EmailMarkupUtilities.resolveOutlookConditional('</td></tr></table>');

    return $ssr.raw(
        EmailMarkupUtilities.resolveOutlookConditional(
            '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" '
            + `style="width:${containerWidth}px;" width="${containerWidth}" ><tr>`
            + '<td style="line-height:0;font-size:0;mso-line-height-rule:exactly;">'
            + `<v:image style="${EmailMarkupUtilities.resolveStyle({
                border: '0',
                height: p.backgroundHeight,
                'mso-position-horizontal': 'center',
                position: 'absolute',
                top: 0,
                width: p.backgroundWidth ?? `${containerWidth}px`,
                'z-index': '-3'
            })}"${EmailMarkupUtilities.resolveAttributes({ src: backgroundUrl })} xmlns:v="urn:schemas-microsoft-com:vml" />`
        )
        + `<div${EmailMarkupUtilities.resolveAttributes({ class: p.cssClass })} style="margin:0 auto;max-width:${containerWidth}px;">`
        + '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody>'
        + `<tr style="vertical-align:top;">${heroCells(p, height, content)}</tr>`
        + '</tbody></table></div>'
        + EmailMarkupUtilities.resolveOutlookConditional('</td></tr></table>')
    );
});