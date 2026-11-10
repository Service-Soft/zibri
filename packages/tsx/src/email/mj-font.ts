import { defineEmailComponent, TsxComponent } from './define-email-component';
import { HeadChannel } from './head-channels';
import { EmailFont } from './head-records';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjFont}.
 */
export type MjFontProps = {
    /**
     * The name the font is used by in a `fontFamily`, e.g. `Raleway`.
     */
    name: string,
    /**
     * The url of the font's stylesheet.
     */
    href: string
};

/**
 * A font the email may import. Mirrors MJML's `mj-font`: it renders nothing, and the head imports the font once a
 * component of the body names it in its font family. A font of MJML's own (`Ubuntu`, `Roboto`, ...) is replaced by
 * one of the same name.
 */
export const MjFont: TsxComponent<MjFontProps> = defineEmailComponent<MjFontProps>('MjFont', (props, $ssr) => {
    const p: MjFontProps = withDefaults($ssr, 'MjFont', props);
    const font: EmailFont = { name: p.name, href: p.href };
    $ssr.collect(HeadChannel.font, JSON.stringify(font));

    return $ssr.raw('');
});