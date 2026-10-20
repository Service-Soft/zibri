import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { withDefaults } from './with-defaults.ts';

/**
 * Props for {@link MjSpacer}.
 */
export type MjSpacerProps = {
    /**
     * The vertical space. Defaults to MJML's `20px`.
     */
    height?: string
};

/**
 * Vertical space. Mirrors MJML's `mj-spacer`: a fixed-height `div` holding a hair space so the cell
 * keeps its height in every client.
 */
export const MjSpacer: TsxComponent<MjSpacerProps> = defineEmailComponent<MjSpacerProps>('MjSpacer', (props, $ssr) => {
    const height: string = withDefaults($ssr, 'MjSpacer', props).height ?? '20px';

    return $ssr.raw(
        '<tr><td style="font-size:0px;word-break:break-word;">'
        + `<div style="height:${height};line-height:${height};">&#8202;</div>`
        + '</td></tr>'
    );
});