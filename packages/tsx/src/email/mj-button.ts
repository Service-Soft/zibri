import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { EmailLayout, EmailLayoutContext } from './email-layout.context.ts';
import { withDefaults } from './with-defaults.ts';

/**
 * Props for {@link MjButton}.
 */
export type MjButtonProps = {
    /**
     * The link the button points to.
     */
    href?: string,
    /**
     * Background color. Defaults to MJML's `#414141`.
     */
    backgroundColor?: string,
    /**
     * Text color. Defaults to `#ffffff`.
     */
    color?: string,
    /**
     * Border radius. Defaults to `3px`.
     */
    borderRadius?: string,
    /**
     * Horizontal alignment within the column. Defaults to `center`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * Padding around the button in its cell. Defaults to `10px 25px`.
     */
    padding?: string,
    /**
     * Padding inside the button. Defaults to `10px 25px`.
     */
    innerPadding?: string,
    /**
     * Font size. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * A CSS class added to the button's cell, so custom styles (like a hover) can target it.
     */
    cssClass?: string
};

/**
 * A call-to-action button. Mirrors MJML's `mj-button`: a single-cell table whose cell is the
 * clickable, padded link, sized and colored for consistent rendering across clients.
 */
export const MjButton: TsxComponent<MjButtonProps> = defineEmailComponent<MjButtonProps>('MjButton', (props, $ssr) => {
    const p: MjButtonProps = withDefaults($ssr, 'MjButton', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const background: string = p.backgroundColor ?? '#414141';
    const color: string = p.color ?? '#ffffff';
    const borderRadius: string = p.borderRadius ?? '3px';
    const align: string = p.align ?? 'center';
    const padding: string = p.padding ?? '10px 25px';
    const innerPadding: string = p.innerPadding ?? '10px 25px';
    const fontSize: string = p.fontSize ?? '13px';
    const href: string = p.href ?? '';
    const cssClass: string = p.cssClass ? ` class="${p.cssClass}"` : '';

    return $ssr.raw(
        `<tr><td align="${align}"${cssClass} style="font-size:0px;padding:${padding};word-break:break-word;">`
        + '<table border="0" cellpadding="0" cellspacing="0" role="presentation" '
        + 'style="border-collapse:separate;line-height:100%;"><tbody><tr>'
        + `<td align="center" bgcolor="${background}" role="presentation" style="border:none;`
        + `border-radius:${borderRadius};cursor:auto;mso-padding-alt:${innerPadding};background:${background};" `
        + 'valign="middle">'
        + `<a href="${href}" style="display:inline-block;background:${background};color:${color};`
        + `font-family:${layout.fontFamily};font-size:${fontSize};font-weight:normal;line-height:120%;margin:0;`
        + `text-decoration:none;text-transform:none;padding:${innerPadding};mso-padding-alt:0px;`
        + `border-radius:${borderRadius};" target="_blank">`
        + $ssr.child(props.children)
        + '</a></td></tr></tbody></table></td></tr>'
    );
});