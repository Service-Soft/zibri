import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { NavbarBaseUrlContext } from './navbar.context';
import { withDefaults } from './with-defaults';
import { isScriptUrl } from '../runtime/server-runtime';

/**
 * Props for {@link MjNavbarLink}.
 */
export type MjNavbarLinkProps = EmailPaddingProps & {
    /**
     * The link, after the `baseUrl` of the navbar.
     */
    href?: string,
    /**
     * The `name` of the link.
     */
    name?: string,
    /**
     * Where the link opens. Defaults to `_blank`.
     */
    target?: string,
    /**
     * The `rel` of the link.
     */
    rel?: string,
    /**
     * Text color. Defaults to `#000000`.
     */
    color?: string,
    /**
     * Font stack. Defaults to `Ubuntu, Helvetica, Arial, sans-serif`.
     */
    fontFamily?: string,
    /**
     * Font size. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * Font style.
     */
    fontStyle?: string,
    /**
     * Font weight. Defaults to `normal`.
     */
    fontWeight?: string,
    /**
     * Letter spacing.
     */
    letterSpacing?: string,
    /**
     * Line height. Defaults to `22px`.
     */
    lineHeight?: string,
    /**
     * Text decoration. Defaults to `none`.
     */
    textDecoration?: string,
    /**
     * Text transform. Defaults to `uppercase`.
     */
    textTransform?: string,
    /**
     * A CSS class added to the link, and with `-outlook` after it to its Outlook cell.
     */
    cssClass?: string
};

/**
 * One link of a navbar. Mirrors MJML's `mj-navbar-link`: a styled link, in a cell of its own for Outlook.
 */
export const MjNavbarLink: TsxComponent<MjNavbarLinkProps> = defineEmailComponent<MjNavbarLinkProps>('MjNavbarLink', (props, $ssr) => {
    const p: MjNavbarLinkProps = withDefaults($ssr, 'MjNavbarLink', props);
    const baseUrl: string | undefined = $ssr.useContext(NavbarBaseUrlContext);
    const written: string | undefined = p.href === undefined ? undefined : `${baseUrl ?? ''}${p.href}`;
    // a link that runs script is left out, as a page leaves it out of any attribute that takes a url
    const href: string | undefined = written === undefined || isScriptUrl(written) ? undefined : written;
    const padding: string | undefined = resolvePaddingOf(p, '15px 10px');
    const link: string = `<a${EmailMarkupUtilities.resolveAttributes({
        class: p.cssClass ? `mj-link ${p.cssClass}` : 'mj-link',
        href,
        rel: p.rel,
        target: p.target ?? '_blank',
        name: p.name
    })} style="${EmailMarkupUtilities.resolveStyle({
        display: 'inline-block',
        color: p.color ?? '#000000',
        'font-family': p.fontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif',
        'font-size': p.fontSize ?? '13px',
        'font-style': p.fontStyle,
        'font-weight': p.fontWeight ?? 'normal',
        'letter-spacing': p.letterSpacing,
        'line-height': p.lineHeight ?? '22px',
        'text-decoration': p.textDecoration ?? 'none',
        'text-transform': p.textTransform ?? 'uppercase',
        padding
    })}">${$ssr.child(props.children)}</a>`;

    const outlookClass: string = EmailMarkupUtilities.suffixClasses(p.cssClass, 'outlook');

    return $ssr.raw(
        EmailMarkupUtilities.resolveOutlookConditional(
            `<td style="${EmailMarkupUtilities.resolveStyle({ padding })}" class="${outlookClass}" >`
        )
        + link
        + EmailMarkupUtilities.resolveOutlookConditional('</td>')
    );
});