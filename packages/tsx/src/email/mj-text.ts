import { defineEmailComponent, TsxComponent } from './define-email-component';
import { resolvePadding } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjText}.
 */
export type MjTextProps = {
    /**
     * Horizontal text alignment. Defaults to `left`.
     */
    align?: 'left' | 'center' | 'right' | 'justify',
    /**
     * Text color. Inherited from the layout when unset.
     */
    color?: string,
    /**
     * Font stack. Inherited from the layout when unset.
     */
    fontFamily?: string,
    /**
     * Font size. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * Font weight, e.g. `bold` or `700`.
     */
    fontWeight?: string,
    /**
     * Font style, e.g. `italic`.
     */
    fontStyle?: 'normal' | 'italic' | 'oblique',
    /**
     * Letter spacing.
     */
    letterSpacing?: string,
    /**
     * Text decoration, e.g. `underline`.
     */
    textDecoration?: string,
    /**
     * Text transform, e.g. `uppercase`.
     */
    textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase',
    /**
     * Line height. Inherited from the layout when unset.
     */
    lineHeight?: string | number,
    /**
     * Table cell padding. Defaults to MJML's `10px 25px`.
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
     * Background color of the surrounding cell.
     */
    containerBackgroundColor?: string,
    /**
     * A fixed height for the cell.
     */
    height?: string,
    /**
     * A CSS class added to the text `div`.
     */
    cssClass?: string
};

/**
 * A block of text, rendered as one row of the enclosing column's table. Mirrors MJML's `mj-text`:
 * an aligned cell holding a `div` that carries the typography.
 */
export const MjText: TsxComponent<MjTextProps> = defineEmailComponent<MjTextProps>('MjText', (props, $ssr) => {
    const p: MjTextProps = withDefaults($ssr, 'MjText', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const align: string = p.align ?? 'left';
    const padding: string = resolvePadding(p.padding ?? '10px 25px', {
        top: p.paddingTop,
        right: p.paddingRight,
        bottom: p.paddingBottom,
        left: p.paddingLeft
    });
    const cssClass: string = p.cssClass ? ` class="${p.cssClass}"` : '';
    const containerBackground: string = p.containerBackgroundColor ? `background:${p.containerBackgroundColor};` : '';
    const height: string = p.height ? `height:${p.height};` : '';
    const textStyle: string = `font-family:${p.fontFamily ?? layout.fontFamily};font-size:${p.fontSize ?? '13px'};`
        + (p.fontStyle ? `font-style:${p.fontStyle};` : '')
        + (p.fontWeight ? `font-weight:${p.fontWeight};` : '')
        + (p.letterSpacing ? `letter-spacing:${p.letterSpacing};` : '')
        + `line-height:${p.lineHeight ?? layout.lineHeight};`
        + `text-align:${align};`
        + (p.textDecoration ? `text-decoration:${p.textDecoration};` : '')
        + (p.textTransform ? `text-transform:${p.textTransform};` : '')
        + `color:${p.color ?? layout.color};`;

    return $ssr.raw(
        `<tr><td align="${align}" style="${containerBackground}${height}font-size:0px;padding:${padding};word-break:break-word;">`
        + `<div${cssClass} style="${textStyle}">`
        + $ssr.child(props.children)
        + '</div></td></tr>'
    );
});