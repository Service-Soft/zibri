import { defineEmailComponent, TsxComponent } from './define-email-component';
import { pixels, resolvePadding } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjWrapper}.
 */
export type MjWrapperProps = {
    /**
     * Cell padding around the wrapper's content. Defaults to MJML's `20px 0`.
     */
    padding?: string,
    /**
     * Overrides the top padding.
     */
    paddingTop?: string,
    /**
     * Overrides the right padding.
     */
    paddingRight?: string,
    /**
     * Overrides the bottom padding.
     */
    paddingBottom?: string,
    /**
     * Overrides the left padding.
     */
    paddingLeft?: string,
    /**
     * Background color of the wrapper.
     */
    backgroundColor?: string,
    /**
     * Border radius of the wrapper.
     */
    borderRadius?: string,
    /**
     * A drop shadow for the wrapper. Beyond MJML's attribute set (MJML has no box-shadow), and many
     * email clients strip it - clients that support it render it, the rest simply ignore it.
     */
    boxShadow?: string,
    /**
     * A CSS class added to the wrapper's Outlook ghost table.
     */
    cssClass?: string
};

/**
 * A container for whole sections. Mirrors MJML's `mj-wrapper`: the same full-width band a section
 * is, but its children are sections rather than columns, wrapped in an extra Outlook ghost table.
 */
export const MjWrapper: TsxComponent<MjWrapperProps> = defineEmailComponent<MjWrapperProps>('MjWrapper', (props, $ssr) => {
    const p: MjWrapperProps = withDefaults($ssr, 'MjWrapper', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const width: number = pixels(layout.width);
    const padding: string = resolvePadding(p.padding ?? '20px 0', {
        top: p.paddingTop,
        right: p.paddingRight,
        bottom: p.paddingBottom,
        left: p.paddingLeft
    });
    const background: string = p.backgroundColor ? `background:${p.backgroundColor};` : '';
    const radius: string = p.borderRadius ? `border-radius:${p.borderRadius};` : '';
    const shadow: string = p.boxShadow ? `box-shadow:${p.boxShadow};` : '';
    const ghostClass: string = p.cssClass ?? '';

    return $ssr.raw(
        `<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="${ghostClass}" `
        + `role="presentation" style="width:${width}px;" width="${width}" ><tr>`
        + '<td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->'
        + `<div style="${background}${radius}${shadow}margin:0px auto;max-width:${width}px;">`
        + '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" '
        + `style="${background}${radius}width:100%;"><tbody><tr>`
        + `<td style="direction:${layout.dir};font-size:0px;padding:${padding};text-align:center;">`
        + '<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" '
        + `role="presentation" style="width:${width}px;" width="${width}" ><tr><td style="" ><![endif]-->`
        + $ssr.child(props.children)
        + '<!--[if mso | IE]></td></tr></table><![endif]-->'
        + '</td></tr></tbody></table></div>'
        + '<!--[if mso | IE]></td></tr></table><![endif]-->'
    );
});