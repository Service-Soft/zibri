import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { pixels } from './dimensions.ts';
import { EmailLayout, EmailLayoutContext } from './email-layout.context.ts';
import { HeadChannel } from './head-channels.ts';
import { withDefaults } from './with-defaults.ts';

/**
 * Props for {@link MjColumn}.
 */
export type MjColumnProps = {
    /**
     * The column width as a percentage of the section, e.g. `50%`. Defaults to `100%`.
     */
    width?: string,
    /**
     * Vertical alignment of the column's content. Defaults to `top`.
     */
    verticalAlign?: 'top' | 'middle' | 'bottom'
};

/**
 * A vertical column within a section. Mirrors MJML's `mj-column`: a ghost `td` for Outlook holding a
 * responsive `div`, wrapping the column's rows in a table. The width is resolved against the section
 * width the layout carries, so the Outlook cell gets a fixed pixel width and the div a percentage.
 *
 * The resolved pixel width becomes the layout width for the column's content, so nested images and
 * dividers size themselves against the column rather than the whole section.
 */
export const MjColumn: TsxComponent<MjColumnProps> = defineEmailComponent<MjColumnProps>('MjColumn', (props, $ssr) => {
    const p: MjColumnProps = withDefaults($ssr, 'MjColumn', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const percent: number = pixels(p.width ?? '100%') || 100;
    const pixelWidth: number = Math.round((pixels(layout.width) * percent) / 100);
    const verticalAlign: string = p.verticalAlign ?? 'top';
    $ssr.provideContext(EmailLayoutContext, { ...layout, width: `${pixelWidth}px` });
    // Surface the width so the document can emit the matching responsive rule in its head.
    $ssr.collect(HeadChannel.columnWidth, String(percent));

    return $ssr.raw(
        `<!--[if mso | IE]><td class="" style="vertical-align:${verticalAlign};width:${pixelWidth}px;" ><![endif]-->`
        + `<div class="mj-column-per-${percent} mj-outlook-group-fix" style="font-size:0px;text-align:left;`
        + `direction:${layout.dir};display:inline-block;vertical-align:${verticalAlign};width:${percent}%;">`
        + '<table border="0" cellpadding="0" cellspacing="0" role="presentation" '
        + `style="vertical-align:${verticalAlign};" width="100%"><tbody>`
        + $ssr.child(props.children)
        + '</tbody></table></div>'
        + '<!--[if mso | IE]></td><![endif]-->'
    );
});