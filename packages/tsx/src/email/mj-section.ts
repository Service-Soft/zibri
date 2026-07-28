import { defineEmailComponent, TsxComponent } from './define-email-component';
import { pixels, resolvePadding } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjSection}.
 */
export type MjSectionProps = {
    /**
     * Cell padding around the section's content. Defaults to MJML's `20px 0`.
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
     * Horizontal alignment of the columns. Defaults to `center`.
     */
    textAlign?: 'left' | 'center' | 'right' | 'justify',
    /**
     * Background color of the section.
     */
    backgroundColor?: string,
    /**
     * Border radius of the section.
     */
    borderRadius?: string,
    /**
     * A CSS class added to the section's Outlook ghost table.
     */
    cssClass?: string
};

/**
 * A full-width horizontal band holding columns. Mirrors MJML's `mj-section`: an Outlook ghost table
 * fixed to the body width wraps a centered `div`/`table` that the columns lay out inside as inline
 * blocks. The section's width comes from the layout the body established.
 */
export const MjSection: TsxComponent<MjSectionProps> = defineEmailComponent<MjSectionProps>('MjSection', (props, $ssr) => {
    const p: MjSectionProps = withDefaults($ssr, 'MjSection', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const width: number = pixels(layout.width);
    const padding: string = resolvePadding(p.padding ?? '20px 0', {
        top: p.paddingTop,
        right: p.paddingRight,
        bottom: p.paddingBottom,
        left: p.paddingLeft
    });
    const textAlign: string = p.textAlign ?? 'center';
    const background: string = p.backgroundColor ? `background:${p.backgroundColor};` : '';
    const cellBackground: string = p.backgroundColor ? `background:${p.backgroundColor};` : '';
    const radius: string = p.borderRadius ? `border-radius:${p.borderRadius};` : '';
    const ghostClass: string = p.cssClass ?? '';

    return $ssr.raw(
        `<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="${ghostClass}" `
        + `role="presentation" style="width:${width}px;" width="${width}" ><tr>`
        + '<td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->'
        + `<div style="${background}${radius}margin:0px auto;max-width:${width}px;">`
        + '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" '
        + `style="${cellBackground}width:100%;"><tbody><tr>`
        + `<td style="direction:${layout.dir};font-size:0px;padding:${padding};text-align:${textAlign};">`
        + '<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><![endif]-->'
        + $ssr.child(props.children)
        + '<!--[if mso | IE]></tr></table><![endif]-->'
        + '</td></tr></tbody></table></div>'
        + '<!--[if mso | IE]></td></tr></table><![endif]-->'
    );
});