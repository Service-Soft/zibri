import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { HeadChannel } from './head-channels';
import { NavbarBaseUrlContext } from './navbar.context';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjNavbar}.
 */
export type MjNavbarProps = EmailPaddingProps & {
    /**
     * Horizontal alignment of the links. Defaults to `center`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * A url put before the `href` of each link.
     */
    baseUrl?: string,
    /**
     * `hamburger` folds the links behind a menu icon on mobile.
     */
    hamburger?: 'hamburger',
    /**
     * Horizontal alignment of the menu icon. Defaults to `center`.
     */
    icoAlign?: 'left' | 'center' | 'right',
    /**
     * The menu icon while the menu is closed. Defaults to `&#9776;`.
     */
    icoOpen?: string,
    /**
     * The menu icon while the menu is open. Defaults to `&#8855;`.
     */
    icoClose?: string,
    /**
     * Color of the menu icon. Defaults to `#000000`.
     */
    icoColor?: string,
    /**
     * Font size of the menu icon. Defaults to `30px`.
     */
    icoFontSize?: string,
    /**
     * Font stack of the menu icon. Defaults to `Ubuntu, Helvetica, Arial, sans-serif`.
     */
    icoFontFamily?: string,
    /**
     * Text transform of the menu icon. Defaults to `uppercase`.
     */
    icoTextTransform?: string,
    /**
     * Text decoration of the menu icon. Defaults to `none`.
     */
    icoTextDecoration?: string,
    /**
     * Line height of the menu icon. Defaults to `30px`.
     */
    icoLineHeight?: string,
    /**
     * Padding around the menu icon. Defaults to `10px`.
     */
    icoPadding?: string,
    /**
     * Overrides the top padding of the menu icon.
     */
    icoPaddingTop?: string,
    /**
     * Overrides the right padding of the menu icon.
     */
    icoPaddingRight?: string,
    /**
     * Overrides the bottom padding of the menu icon.
     */
    icoPaddingBottom?: string,
    /**
     * Overrides the left padding of the menu icon.
     */
    icoPaddingLeft?: string,
    /**
     * A CSS class added to the surrounding cell.
     */
    cssClass?: string
};

/**
 * The menu icon of a hamburger navbar, which a checkbox no client but Outlook sees opens and closes.
 * @param p - The navbar's props, with their defaults.
 * @returns The checkbox and the icon.
 */
function hamburger(p: MjNavbarProps): string {
    const id: string = EmailMarkupUtilities.resolveRandomId();
    const label: string = EmailMarkupUtilities.resolveStyle({
        display: 'block',
        cursor: 'pointer',
        'mso-hide': 'all',
        '-moz-user-select': 'none',
        'user-select': 'none',
        color: p.icoColor ?? '#000000',
        'font-size': p.icoFontSize ?? '30px',
        'font-family': p.icoFontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif',
        'text-transform': p.icoTextTransform ?? 'uppercase',
        'text-decoration': p.icoTextDecoration ?? 'none',
        'line-height': p.icoLineHeight ?? '30px',
        padding: resolvePaddingOf({
            padding: p.icoPadding,
            paddingTop: p.icoPaddingTop,
            paddingRight: p.icoPaddingRight,
            paddingBottom: p.icoPaddingBottom,
            paddingLeft: p.icoPaddingLeft
        }, '10px')
    });
    return EmailMarkupUtilities.resolveMsoConditional(
        `<input type="checkbox" id="${id}" class="mj-menu-checkbox" style="display:none !important; max-height:0; visibility:hidden;" />`,
        true
    )
    + '<div class="mj-menu-trigger" style="display:none;max-height:0px;max-width:0px;font-size:0px;overflow:hidden;">'
    + `<label for="${id}" class="mj-menu-label" style="${label}" align="${p.icoAlign ?? 'center'}">`
    + `<span class="mj-menu-icon-open" style="mso-hide:all;">${p.icoOpen ?? '&#9776;'}</span>`
    + `<span class="mj-menu-icon-close" style="display:none;mso-hide:all;">${p.icoClose ?? '&#8855;'}</span>`
    + '</label></div>';
}

/**
 * A row of links. Mirrors MJML's `mj-navbar`: its `MjNavbarLink`s side by side, which a hamburger navbar folds
 * behind a menu icon on mobile.
 */
export const MjNavbar: TsxComponent<MjNavbarProps> = defineEmailComponent<MjNavbarProps>('MjNavbar', (props, $ssr) => {
    const p: MjNavbarProps = withDefaults($ssr, 'MjNavbar', props);
    const align: string = p.align ?? 'center';
    $ssr.collect(HeadChannel.componentStyle, 'MjNavbar');
    $ssr.provideContext(NavbarBaseUrlContext, p.baseUrl);
    const links: string = $ssr.child(props.children);

    return $ssr.raw(EmailMarkupUtilities.resolveRow({ align, cssClass: p.cssClass, padding: resolvePaddingOf(p, undefined) },
        (p.hamburger === 'hamburger' ? hamburger(p) : '')
        + '<div class="mj-inline-links">'
        + EmailMarkupUtilities.resolveOutlookConditional(
            `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align}"><tr>`
        )
        + links
        + EmailMarkupUtilities.resolveOutlookConditional('</tr></table>')
        + '</div>'));
});