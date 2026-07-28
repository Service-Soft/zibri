import { defineEmailComponent, TsxComponent } from './define-email-component';
import { pixels } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { HeadChannel } from './head-channels';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjGroup}.
 */
export type MjGroupProps = {
    /**
     * The group width as a percentage of the section, e.g. `50%`. Defaults to `100%`.
     */
    width?: string
};

/**
 * A group of columns that stay side by side, even on mobile. Mirrors MJML's `mj-group`: like a
 * column shell, but its own ghost table lays the child columns out horizontally and the stacking
 * media query is suppressed. The child columns resolve their widths against the group.
 */
export const MjGroup: TsxComponent<MjGroupProps> = defineEmailComponent<MjGroupProps>('MjGroup', (props, $ssr) => {
    const percent: number = pixels(withDefaults($ssr, 'MjGroup', props).width ?? '100%') || 100;
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const pixelWidth: number = Math.round((pixels(layout.width) * percent) / 100);
    $ssr.provideContext(EmailLayoutContext, { ...layout, width: `${pixelWidth}px` });
    // A group is itself a responsive column, so it needs the same media rule its width demands.
    $ssr.collect(HeadChannel.columnWidth, String(percent));

    return $ssr.raw(
        `<!--[if mso | IE]><td class="" style="vertical-align:top;width:${pixelWidth}px;" ><![endif]-->`
        + `<div class="mj-column-per-${percent} mj-outlook-group-fix" style="font-size:0;line-height:0;`
        + `text-align:left;display:inline-block;width:100%;direction:${layout.dir};">`
        + '<!--[if mso | IE]><table border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><![endif]-->'
        + $ssr.child(props.children)
        + '<!--[if mso | IE]></tr></table><![endif]-->'
        + '</div>'
        + '<!--[if mso | IE]></td><![endif]-->'
    );
});