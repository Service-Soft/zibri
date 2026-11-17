import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { SocialContext } from './social.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjSocial}.
 */
export type MjSocialProps = EmailPaddingProps & {
    /**
     * Horizontal alignment within the column. Defaults to `center`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * `horizontal` lays the elements out side by side, `vertical` one below the other. Defaults to `horizontal`.
     */
    mode?: 'horizontal' | 'vertical',
    /**
     * The border of each icon.
     */
    border?: string,
    /**
     * The border radius of each icon. Defaults to `3px`.
     */
    borderRadius?: string,
    /**
     * Background color of the surrounding cell.
     */
    containerBackgroundColor?: string,
    /**
     * Text color of each element. Defaults to `#333333`.
     */
    color?: string,
    /**
     * Font stack of each element. Defaults to `Ubuntu, Helvetica, Arial, sans-serif`.
     */
    fontFamily?: string,
    /**
     * Font size of each element. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * Font style of each element.
     */
    fontStyle?: string,
    /**
     * Font weight of each element.
     */
    fontWeight?: string,
    /**
     * The width of each icon. Defaults to `20px`.
     */
    iconSize?: string,
    /**
     * The height of each icon, its width when unset.
     */
    iconHeight?: string,
    /**
     * Padding around each icon.
     */
    iconPadding?: string,
    /**
     * Padding around each element.
     */
    innerPadding?: string,
    /**
     * Line height of each element. Defaults to `22px`.
     */
    lineHeight?: string,
    /**
     * Padding around the text of each element.
     */
    textPadding?: string,
    /**
     * Text decoration of each element. Defaults to `none`.
     */
    textDecoration?: string,
    /**
     * A CSS class added to the surrounding cell.
     */
    cssClass?: string
};

/**
 * Links to social networks. Mirrors MJML's `mj-social`: its `MjSocialElement`s side by side or one below the other,
 * each taking the attributes it passes them unless they set their own.
 */
export const MjSocial: TsxComponent<MjSocialProps> = defineEmailComponent<MjSocialProps>('MjSocial', (props, $ssr) => {
    const p: MjSocialProps = withDefaults($ssr, 'MjSocial', props);
    const mode: 'horizontal' | 'vertical' = p.mode ?? 'horizontal';
    const align: string = p.align ?? 'center';
    $ssr.provideContext(SocialContext, {
        mode,
        align,
        passed: {
            padding: p.innerPadding,
            border: p.border,
            borderRadius: p.borderRadius ?? '3px',
            color: p.color ?? '#333333',
            fontFamily: p.fontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif',
            fontSize: p.fontSize ?? '13px',
            fontWeight: p.fontWeight,
            fontStyle: p.fontStyle,
            iconSize: p.iconSize ?? '20px',
            iconHeight: p.iconHeight,
            iconPadding: p.iconPadding,
            textPadding: p.textPadding,
            lineHeight: p.lineHeight ?? '22px',
            textDecoration: p.textDecoration ?? 'none'
        }
    });
    const elements: string = $ssr.child(props.children);
    const content: string = mode === 'horizontal'
        ? EmailMarkupUtilities.resolveOutlookConditional(
            `<table align="${align}" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr>`
        ) + elements + EmailMarkupUtilities.resolveOutlookConditional('</tr></table>')
        : `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0px;"><tbody>${elements}</tbody></table>`;

    return $ssr.raw(EmailMarkupUtilities.resolveRow({
        align,
        cssClass: p.cssClass,
        containerBackgroundColor: p.containerBackgroundColor,
        padding: resolvePaddingOf(p, '10px 25px')
    }, content));
});