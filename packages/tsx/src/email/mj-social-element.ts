import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { SocialContext, SocialPassedAttributes, SocialSettings } from './social.context';
import { withDefaults } from './with-defaults';
import { isScriptUrl } from '../runtime/server-runtime';

/**
 * Props for {@link MjSocialElement}.
 */
export type MjSocialElementProps = EmailPaddingProps & {
    /**
     * The network, which gives the element its icon, its color and its share link, e.g. `facebook`, `x`, `github` or
     * `linkedin`. `-noshare` after the name, as in `facebook-noshare`, links to `href` itself.
     */
    name?: string,
    /**
     * The link. For a network with a share link, the url shared on it.
     */
    href?: string,
    /**
     * Horizontal alignment of the text. Defaults to `left`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * Whether the icon is `left` or `right` of the text. Defaults to `left`.
     */
    iconPosition?: 'left' | 'right',
    /**
     * Background color of the icon. Defaults to the network's color.
     */
    backgroundColor?: string,
    /**
     * Text color. Defaults to `#000`.
     */
    color?: string,
    /**
     * The border of the icon. Defaults to `0`.
     */
    border?: string,
    /**
     * The border radius of the icon. Defaults to `3px`.
     */
    borderRadius?: string,
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
     * Font weight.
     */
    fontWeight?: string,
    /**
     * The width of the icon.
     */
    iconSize?: string,
    /**
     * The height of the icon, its width when unset.
     */
    iconHeight?: string,
    /**
     * Padding around the icon.
     */
    iconPadding?: string,
    /**
     * Line height. Defaults to `1`.
     */
    lineHeight?: string,
    /**
     * Padding around the text. Defaults to `4px 4px 4px 0`.
     */
    textPadding?: string,
    /**
     * The `rel` of the link.
     */
    rel?: string,
    /**
     * The url of the icon. Defaults to the network's icon.
     */
    src?: string,
    /**
     * The `srcset` of the icon.
     */
    srcset?: string,
    /**
     * The `sizes` of the icon.
     */
    sizes?: string,
    /**
     * The alternative text of the icon.
     */
    alt?: string,
    /**
     * The title of the icon.
     */
    title?: string,
    /**
     * Where the link opens. Defaults to `_blank`.
     */
    target?: string,
    /**
     * Text decoration. Defaults to `none`.
     */
    textDecoration?: string,
    /**
     * Vertical alignment of the icon. Defaults to `middle`.
     */
    verticalAlign?: 'top' | 'middle' | 'bottom',
    /**
     * A CSS class added to the element's row.
     */
    cssClass?: string
};

/**
 * What a network gives an element of it.
 */
type SocialNetwork = {
    /**
     * The link sharing a url on the network, `[[URL]]` standing for the url.
     */
    shareUrl?: string,
    /**
     * The network's color.
     */
    backgroundColor: string,
    /**
     * The network's icon.
     */
    src: string
};

/**
 * Where MJML keeps the icons of the networks.
 */
const IMG_BASE_URL: string = 'https://www.mailjet.com/images/theme/v1/icons/ico-social/';

/**
 * The networks MJML knows, by name.
 */
const SOCIAL_NETWORKS: Readonly<Record<string, SocialNetwork>> = {
    facebook: { shareUrl: 'https://www.facebook.com/sharer/sharer.php?u=[[URL]]', backgroundColor: '#3b5998', src: `${IMG_BASE_URL}facebook.png` },
    twitter: { shareUrl: 'https://twitter.com/intent/tweet?url=[[URL]]', backgroundColor: '#55acee', src: `${IMG_BASE_URL}twitter.png` },
    x: { shareUrl: 'https://twitter.com/intent/tweet?url=[[URL]]', backgroundColor: '#000000', src: `${IMG_BASE_URL}twitter-x.png` },
    google: { shareUrl: 'https://plus.google.com/share?url=[[URL]]', backgroundColor: '#dc4e41', src: `${IMG_BASE_URL}google-plus.png` },
    pinterest: {
        shareUrl: 'https://pinterest.com/pin/create/button/?url=[[URL]]&media=&description=',
        backgroundColor: '#bd081c',
        src: `${IMG_BASE_URL}pinterest.png`
    },
    linkedin: {
        shareUrl: 'https://www.linkedin.com/shareArticle?mini=true&url=[[URL]]&title=&summary=&source=',
        backgroundColor: '#0077b5',
        src: `${IMG_BASE_URL}linkedin.png`
    },
    instagram: { backgroundColor: '#3f729b', src: `${IMG_BASE_URL}instagram.png` },
    web: { backgroundColor: '#4BADE9', src: `${IMG_BASE_URL}web.png` },
    snapchat: { backgroundColor: '#FFFA54', src: `${IMG_BASE_URL}snapchat.png` },
    youtube: { backgroundColor: '#EB3323', src: `${IMG_BASE_URL}youtube.png` },
    tumblr: { shareUrl: 'https://www.tumblr.com/widgets/share/tool?canonicalUrl=[[URL]]', backgroundColor: '#344356', src: `${IMG_BASE_URL}tumblr.png` },
    github: { backgroundColor: '#000000', src: `${IMG_BASE_URL}github.png` },
    xing: { shareUrl: 'https://www.xing.com/app/user?op=share&url=[[URL]]', backgroundColor: '#296366', src: `${IMG_BASE_URL}xing.png` },
    vimeo: { backgroundColor: '#53B4E7', src: `${IMG_BASE_URL}vimeo.png` },
    medium: { backgroundColor: '#000000', src: `${IMG_BASE_URL}medium.png` },
    soundcloud: { backgroundColor: '#EF7F31', src: `${IMG_BASE_URL}soundcloud.png` },
    dribbble: { backgroundColor: '#D95988', src: `${IMG_BASE_URL}dribbble.png` }
};

/**
 * The network of a name, a `-noshare` one linking to the url itself.
 * @param name - The name, if the element has one.
 * @returns The network, or undefined for a name MJML does not know.
 */
function findSocialNetwork(name: string | undefined): SocialNetwork | undefined {
    if (name == undefined) {
        return undefined;
    }
    const shared: SocialNetwork | undefined = SOCIAL_NETWORKS[name];
    if (shared !== undefined) {
        return shared;
    }
    const unshared: SocialNetwork | undefined = name.endsWith('-noshare') ? SOCIAL_NETWORKS[name.slice(0, -'-noshare'.length)] : undefined;
    return unshared === undefined ? undefined : { ...unshared, shareUrl: '[[URL]]' };
}

/**
 * One link to a social network, an icon beside its text. Mirrors MJML's `mj-social-element`: in an `MjSocial`, it
 * takes the attributes the social passes unless it sets its own, and a network it names gives it an icon, a color
 * and a share link.
 */
export const MjSocialElement: TsxComponent<MjSocialElementProps> = defineEmailComponent<MjSocialElementProps>(
    'MjSocialElement',
    (props, $ssr) => {
        const social: SocialSettings | undefined = $ssr.useContext(SocialContext);
        const passed: SocialPassedAttributes = social?.passed ?? {};
        // the element's own props win over what the social passes, and leave out every prop that is not set
        const p: MjSocialElementProps = { ...passed, ...withDefaults($ssr, 'MjSocialElement', props) };
        const network: SocialNetwork | undefined = findSocialNetwork(p.name);
        const ownHref: string | undefined = p.href == undefined || isScriptUrl(p.href) ? undefined : p.href;
        const href: string | undefined = ownHref !== undefined && network?.shareUrl !== undefined
            ? network.shareUrl.replace('[[URL]]', ownHref)
            : ownHref;
        const iconSize: string | undefined = p.iconSize;
        const src: string | undefined = p.src ?? network?.src;
        const borderRadius: string = p.borderRadius ?? '3px';
        const link: string = EmailMarkupUtilities.resolveAttributes({ href, rel: p.rel, target: p.target ?? '_blank' });
        const icon: string = `<td style="${EmailMarkupUtilities.resolveStyle({
            padding: resolvePaddingOf(p, '4px'),
            'vertical-align': p.verticalAlign ?? 'middle'
        })}"><table border="0" cellpadding="0" cellspacing="0" role="presentation" style="${EmailMarkupUtilities.resolveStyle({
            background: p.backgroundColor ?? network?.backgroundColor,
            'border-radius': borderRadius,
            width: iconSize
        })}"><tbody><tr><td style="${EmailMarkupUtilities.resolveStyle({
            padding: p.iconPadding,
            'font-size': '0',
            height: p.iconHeight ?? iconSize,
            'vertical-align': 'middle',
            width: iconSize
        })}">${href === undefined ? '' : `<a${link}>`}<img${EmailMarkupUtilities.resolveAttributes({
            alt: p.alt ?? '',
            title: p.title,
            src: src == undefined || isScriptUrl(src) ? undefined : src,
            style: EmailMarkupUtilities.resolveStyle({ border: p.border ?? '0', 'border-radius': borderRadius, display: 'block' }),
            width: iconSize === undefined ? undefined : Number.parseInt(iconSize, 10),
            sizes: p.sizes,
            srcset: p.srcset
        })} />${href === undefined ? '' : '</a>'}</td></tr></tbody></table></td>`;
        const label: string = $ssr.child(props.children);
        const textStyle: string = EmailMarkupUtilities.resolveStyle({
            color: p.color ?? '#000',
            'font-size': p.fontSize ?? '13px',
            'font-weight': p.fontWeight,
            'font-style': p.fontStyle,
            'font-family': p.fontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif',
            'line-height': p.lineHeight ?? '1',
            'text-decoration': p.textDecoration ?? 'none'
        });
        const labelMarkup: string = href === undefined
            ? `<span style="${textStyle}">${label}</span>`
            : `<a${link} style="${textStyle}">${label}</a>`;
        const text: string = label.trim() === ''
            ? ''
            : `<td style="${EmailMarkupUtilities.resolveStyle({
                'vertical-align': 'middle',
                padding: p.textPadding ?? '4px 4px 4px 0',
                'text-align': p.align ?? 'left'
            })}">${labelMarkup}</td>`;
        const row: string = `<tr${EmailMarkupUtilities.resolveAttributes({ class: p.cssClass })}>`
            + (p.iconPosition === 'right' ? text + icon : icon + text)
            + '</tr>';
        // side by side, each element is a table of its own, which Outlook gets a cell for
        return $ssr.raw(social?.mode === 'horizontal'
            ? EmailMarkupUtilities.resolveOutlookConditional('<td>')
            + `<table align="${social.align}" border="0" cellpadding="0" cellspacing="0" role="presentation" `
            + 'style="float:none;display:inline-table;">'
            + `<tbody>${row}</tbody></table>`
            + EmailMarkupUtilities.resolveOutlookConditional('</td>')
            : row);
    }
);