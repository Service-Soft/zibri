import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { horizontalPadding, pixels } from './dimensions.ts';
import { EmailLayout, EmailLayoutContext } from './email-layout.context.ts';
import { withDefaults } from './with-defaults.ts';

/**
 * Props for {@link MjImage}.
 */
export type MjImageProps = {
    /**
     * The image source URL.
     */
    src?: string,
    /**
     * The alternative text.
     */
    alt?: string,
    /**
     * Horizontal alignment within the column. Defaults to `center`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * A fixed image width, e.g. `200px`. Capped to the column width. Defaults to the full column.
     */
    width?: string,
    /**
     * A fixed image height, e.g. `200px`. Defaults to `auto`.
     */
    height?: string,
    /**
     * Padding around the image in its cell. Defaults to `10px 25px`.
     */
    padding?: string
};

/**
 * An image. Mirrors MJML's `mj-image`: a fluid image capped to the container width, wrapped in the
 * collapsing table MJML uses so it renders block-level in every client. The pixel width is resolved
 * against the column width minus padding, exactly as MJML computes it.
 */
export const MjImage: TsxComponent<MjImageProps> = defineEmailComponent<MjImageProps>('MjImage', (props, $ssr) => {
    const p: MjImageProps = withDefaults($ssr, 'MjImage', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const align: string = p.align ?? 'center';
    const padding: string = p.padding ?? '10px 25px';
    const columnWidth: number = pixels(layout.width) - horizontalPadding(padding);
    // An explicit width is capped to the column, exactly as MJML does; otherwise the image fills it.
    const width: number = p.width ? Math.min(pixels(p.width), columnWidth) : columnWidth;
    const heightStyle: string = p.height ? `height:${p.height};` : 'height:auto;';
    const heightAttr: string = p.height ? String(pixels(p.height)) : 'auto';
    const src: string = p.src ?? '';
    const alt: string = p.alt ?? '';

    return $ssr.raw(
        `<tr><td align="${align}" style="font-size:0px;padding:${padding};word-break:break-word;">`
        + '<table border="0" cellpadding="0" cellspacing="0" role="presentation" '
        + 'style="border-collapse:collapse;border-spacing:0px;"><tbody><tr>'
        + `<td style="width:${width}px;">`
        + `<img alt="${alt}" src="${src}" style="border:0;display:block;outline:none;text-decoration:none;`
        + `${heightStyle}width:100%;font-size:13px;" width="${width}" height="${heightAttr}" />`
        + '</td></tr></tbody></table></td></tr>'
    );
});