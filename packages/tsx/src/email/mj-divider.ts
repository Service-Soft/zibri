import { defineEmailComponent, TsxComponent } from './define-email-component';
import { horizontalPadding, pixels } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjDivider}.
 */
export type MjDividerProps = {
    /**
     * The divider line, as a CSS `border` value. Defaults to MJML's `solid 4px #000000`.
     */
    borderTop?: string,
    /**
     * Padding around the divider in its cell. Defaults to `10px 25px`.
     */
    padding?: string
};

/**
 * A horizontal rule. Mirrors MJML's `mj-divider`: a bordered `p` for modern clients plus the ghost
 * table Outlook needs, both sized to the column content width.
 */
export const MjDivider: TsxComponent<MjDividerProps> = defineEmailComponent<MjDividerProps>('MjDivider', (props, $ssr) => {
    const p: MjDividerProps = withDefaults($ssr, 'MjDivider', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const border: string = p.borderTop ?? 'solid 4px #000000';
    const padding: string = p.padding ?? '10px 25px';
    const width: number = pixels(layout.width) - horizontalPadding(padding);

    return $ssr.raw(
        `<tr><td align="center" style="font-size:0px;padding:${padding};word-break:break-word;">`
        + `<p style="border-top:${border};font-size:1px;margin:0px auto;width:100%;"></p>`
        + '<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" '
        + `style="border-top:${border};font-size:1px;margin:0px auto;width:${width}px;" role="presentation" `
        + `width="${width}px" ><tr><td style="height:0;line-height:0;"> &nbsp;\n</td></tr></table><![endif]-->`
        + '</td></tr>'
    );
});