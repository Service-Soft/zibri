import { CarouselImagesContext } from './carousel.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, pixels, resolvePaddingOf } from './dimensions';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { HeadChannel } from './head-channels';
import { MjCarouselImageProps } from './mj-carousel-image';
import { withDefaults } from './with-defaults';
import { isScriptUrl } from '../runtime/server-runtime';

/**
 * Props for {@link MjCarousel}.
 */
export type MjCarouselProps = EmailPaddingProps & {
    /**
     * Horizontal alignment within the column. Defaults to `center`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * Border radius of the images. Defaults to `6px`.
     */
    borderRadius?: string,
    /**
     * Background color of the surrounding cell.
     */
    containerBackgroundColor?: string,
    /**
     * The width of the arrows. Defaults to `44px`.
     */
    iconWidth?: string,
    /**
     * The url of the arrow to the previous image.
     */
    leftIcon?: string,
    /**
     * The url of the arrow to the next image.
     */
    rightIcon?: string,
    /**
     * `visible` shows the thumbnails, `hidden` leaves them out, `supported` shows them only where the carousel works.
     * Defaults to `visible`.
     */
    thumbnails?: 'visible' | 'hidden' | 'supported',
    /**
     * The border of each thumbnail. Defaults to `2px solid transparent`.
     */
    tbBorder?: string,
    /**
     * The border radius of each thumbnail. Defaults to `6px`.
     */
    tbBorderRadius?: string,
    /**
     * The border color of a thumbnail under the pointer. Defaults to `#fead0d`.
     */
    tbHoverBorderColor?: string,
    /**
     * The border color of the thumbnail of the image shown. Defaults to `#ccc`.
     */
    tbSelectedBorderColor?: string,
    /**
     * The width of each thumbnail. Defaults to `110px`.
     */
    tbWidth?: string,
    /**
     * A CSS class added to the surrounding cell.
     */
    cssClass?: string
};

/**
 * A url the carousel may write, or undefined for one that runs script.
 * @param url - The url, if there is one.
 * @returns The url, or undefined.
 */
function safeUrl(url: string | undefined): string | undefined {
    return url == undefined || isScriptUrl(url) ? undefined : url;
}

/**
 * The numbers from 0 to below a count.
 * @param count - The count.
 * @returns The numbers.
 */
function range(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index);
}

/**
 * The CSS that switches the images of one carousel, by the radio checked and the thumbnail under the pointer.
 * Mirrors the `componentHeadStyle` of MJML's `mj-carousel`.
 * @param id - The carousel's id.
 * @param count - How many images it has.
 * @param p - The carousel's props, with their defaults.
 * @returns The CSS.
 */
function carouselStyle(id: string, count: number, p: MjCarouselProps): string {
    const siblings: (index: number) => string = index => '+ * '.repeat(count - index - 1);
    const checked: (index: number) => string = index => `.mj-carousel-${id}-radio-${index + 1}:checked `
        + `${siblings(index)}+ .mj-carousel-content`;
    // the operator precedence is MJML's, which makes the next of the last image the first
    const next: (index: number) => number = index => ((index + (1 % count) + count) % count) + 1;
    const previous: (index: number) => number = index => ((index - (1 % count) + count) % count) + 1;
    // the selector of each image, joined into the selector of one rule
    const selectors: (selector: (index: number) => string) => string = selector => range(count)
        .map(index => selector(index))
        .join(',');
    const hiddenImages: string = selectors(index => `.mj-carousel-${id}-radio:checked ${'+ * '.repeat(index)}`
        + '+ .mj-carousel-content .mj-carousel-image');
    const shownImages: string = selectors(index => `${checked(index)} .mj-carousel-image-${index + 1}`);
    const nextIcons: string = selectors(index => `${checked(index)} .mj-carousel-next-${next(index)}`);
    const previousIcons: string = selectors(index => `${checked(index)} .mj-carousel-previous-${previous(index)}`);
    const selectedThumbnails: string = selectors(index => `${checked(index)} .mj-carousel-${id}-thumbnail-${index + 1}`);
    const thumbnails: string = selectors(index => `${checked(index)} .mj-carousel-${id}-thumbnail`);
    const hoveredHidden: string = selectors(index => `.mj-carousel-${id}-thumbnail:hover ${siblings(index)}`
        + '+ .mj-carousel-main .mj-carousel-image');
    const hoveredShown: string = selectors(index => `.mj-carousel-${id}-thumbnail-${index + 1}:hover ${siblings(index)}+ .mj-carousel-main `
        + `.mj-carousel-image-${index + 1}`);
    const firstSelected: string = `.mj-carousel-${id}-radio-1:checked ${'+ *'.repeat(count - 1)}`
        + `+ .mj-carousel-content .mj-carousel-${id}-thumbnail-1`;
    return [
        '.mj-carousel { -webkit-user-select: none; -moz-user-select: none; user-select: none; }',
        `.mj-carousel-${id}-icons-cell { display: table-cell !important; width: ${p.iconWidth ?? '44px'} !important; }`,
        '.mj-carousel-radio, .mj-carousel-next, .mj-carousel-previous { display: none !important; }',
        '.mj-carousel-thumbnail, .mj-carousel-next, .mj-carousel-previous { touch-action: manipulation; }',
        `${hiddenImages} { display: none !important; }`,
        `${shownImages} { display: block !important; }`,
        `.mj-carousel-previous-icons, .mj-carousel-next-icons, ${nextIcons}, ${previousIcons} { display: block !important; }`,
        `${selectedThumbnails} { border-color: ${p.tbSelectedBorderColor ?? '#ccc'} !important; }`,
        `${thumbnails} { display: inline-block !important; }`,
        '.mj-carousel-image img + div, .mj-carousel-thumbnail img + div { display: none !important; }',
        `${hoveredHidden} { display: none !important; }`,
        `.mj-carousel-thumbnail:hover { border-color: ${p.tbHoverBorderColor ?? '#fead0d'} !important; }`,
        `${hoveredShown} { display: block !important; }`,
        '.mj-carousel noinput { display:block !important; }',
        '.mj-carousel noinput .mj-carousel-image-1 { display: block !important; }',
        '.mj-carousel noinput .mj-carousel-arrows, .mj-carousel noinput .mj-carousel-thumbnails { display: none !important; }',
        '[owa] .mj-carousel-thumbnail { display: none !important; }',
        '@media screen yahoo {',
        `.mj-carousel-${id}-icons-cell, .mj-carousel-previous-icons, .mj-carousel-next-icons { display: none !important; }`,
        `${firstSelected} { border-color: transparent; }`,
        '}'
    ].join('');
}

/**
 * One image as a slide.
 * @param image - The image.
 * @param index - Its position, from 0.
 * @param width - The width of the column, in pixels.
 * @param borderRadius - The carousel's border radius of the images.
 * @returns The slide.
 */
function slide(image: MjCarouselImageProps, index: number, width: number, borderRadius: string): string {
    const img: string = `<img${EmailMarkupUtilities.resolveAttributes({
        title: image.title,
        src: safeUrl(image.src),
        alt: image.alt ?? '',
        style: EmailMarkupUtilities.resolveStyle({
            'border-radius': image.borderRadius ?? borderRadius,
            display: 'block',
            width: `${width}px`,
            'max-width': '100%',
            height: 'auto'
        }),
        width,
        border: '0'
    })} />`;
    const href: string | undefined = safeUrl(image.href);
    return `<div class="mj-carousel-image mj-carousel-image-${index + 1} ${image.cssClass ?? ''}" `
        + `style="${index === 0 ? '' : 'display:none;mso-hide:all;'}">`
        + (href === undefined ? img : `<a${EmailMarkupUtilities.resolveAttributes({ href, rel: image.rel, target: '_blank' })}>${img}</a>`)
        + '</div>';
}

/**
 * The arrows to the previous or the next image, one for each image.
 * @param id - The carousel's id.
 * @param direction - Which arrows.
 * @param icon - The url of the arrow.
 * @param count - How many images the carousel has.
 * @param iconWidth - The width of the arrow.
 * @returns The cell of the arrows.
 */
function controls(id: string, direction: 'previous' | 'next', icon: string | undefined, count: number, iconWidth: string): string {
    const arrows: string = range(count).map(index => `<label for="mj-carousel-${id}-radio-${index + 1}" `
        + `class="mj-carousel-${direction} mj-carousel-${direction}-${index + 1}">`
        + `<img${EmailMarkupUtilities.resolveAttributes({ src: safeUrl(icon), alt: direction })} `
        + `style="display:block;width:${iconWidth};height:auto;" width="${Number.parseInt(iconWidth, 10)}" /></label>`)
        .join('');
    return `<td class="mj-carousel-${id}-icons-cell" style="font-size:0px;display:none;mso-hide:all;padding:0px;">`
        + `<div class="mj-carousel-${direction}-icons" style="display:none;mso-hide:all;">${arrows}</div></td>`;
}

/**
 * A slideshow of images, which the reader switches with arrows and thumbnails. Mirrors MJML's `mj-carousel`: a
 * radio input per `MjCarouselImage`, which CSS in the head shows the image of, and the first image alone for
 * Outlook, which shows no inputs.
 */
export const MjCarousel: TsxComponent<MjCarouselProps> = defineEmailComponent<MjCarouselProps>('MjCarousel', (props, $ssr) => {
    const p: MjCarouselProps = withDefaults($ssr, 'MjCarousel', props);
    const layout: EmailLayout = $ssr.useContext(EmailLayoutContext);
    const images: MjCarouselImageProps[] = [];
    $ssr.provideContext(CarouselImagesContext, images);
    $ssr.child(props.children);
    const id: string = EmailMarkupUtilities.resolveRandomId();
    const width: number = pixels(layout.width);
    const borderRadius: string = p.borderRadius ?? '6px';
    const iconWidth: string = p.iconWidth ?? '44px';
    const thumbnails: string = p.thumbnails ?? 'visible';
    // MJML divides a width its column never hands it, and so always lands on its cap of 110px
    const tbWidth: string = p.tbWidth ?? '110px';
    if (images.length > 0) {
        $ssr.collect(HeadChannel.instanceStyle, carouselStyle(id, images.length, p));
    }
    const radios: string = images.map((_, index) => '<input class="mj-carousel-radio '
        + `mj-carousel-${id}-radio mj-carousel-${id}-radio-${index + 1}"`
        + `${index === 0 ? ' checked="checked"' : ''} type="radio" name="mj-carousel-radio-${id}" `
        + `id="mj-carousel-${id}-radio-${index + 1}" `
        + 'style="display:none;mso-hide:all;" />').join('');
    const thumbnailLinks: string = thumbnails === 'visible' || thumbnails === 'supported'
        ? images.map((image, index) => `<a style="${EmailMarkupUtilities.resolveStyle({
            border: image.tbBorder ?? p.tbBorder ?? '2px solid transparent',
            'border-radius': image.tbBorderRadius ?? p.tbBorderRadius ?? '6px',
            display: thumbnails === 'supported' ? 'none' : 'inline-block',
            overflow: 'hidden',
            width: tbWidth
        })}" href="#${index + 1}" target="${image.target ?? '_blank'}" class="mj-carousel-thumbnail mj-carousel-${id}-thumbnail `
        + `mj-carousel-${id}-thumbnail-${index + 1} ${EmailMarkupUtilities.suffixClasses(image.cssClass, 'thumbnail')}">`
        + `<label for="mj-carousel-${id}-radio-${index + 1}"><img style="display:block;width:100%;height:auto;"`
        + `${EmailMarkupUtilities.resolveAttributes({ src: safeUrl(image.thumbnailsSrc ?? image.src), alt: image.alt ?? '' })} `
        + `width="${Number.parseInt(tbWidth, 10)}" /></label></a>`).join('')
        : '';
    const slides: string = images.map((image, index) => slide(image, index, width, borderRadius)).join('');
    const main: string = '<table style="caption-side:top;display:table-caption;table-layout:fixed;width:100%;" border="0" cellpadding="0" '
        + 'cellspacing="0" width="100%" role="presentation" class="mj-carousel-main"><tbody><tr>'
        + controls(id, 'previous', p.leftIcon ?? 'https://i.imgur.com/xTh3hln.png', images.length, iconWidth)
        + `<td style="padding:0px;"><div class="mj-carousel-images">${slides}</div></td>`
        + controls(id, 'next', p.rightIcon ?? 'https://i.imgur.com/os7o9kz.png', images.length, iconWidth)
        + '</tr></tbody></table>';
    const carousel: string = EmailMarkupUtilities.resolveMsoConditional(
        `<div class="mj-carousel">${radios}<div class="mj-carousel-content mj-carousel-${id}-content" `
        + `style="display:table;width:100%;table-layout:fixed;text-align:center;font-size:0px;">${thumbnailLinks}${main}</div></div>`,
        true
    );
    const fallback: string = images[0] === undefined
        ? ''
        : EmailMarkupUtilities.resolveMsoConditional(slide(images[0], 0, width, borderRadius));

    return $ssr.raw(EmailMarkupUtilities.resolveRow({
        align: p.align ?? 'center',
        cssClass: p.cssClass,
        containerBackgroundColor: p.containerBackgroundColor,
        padding: resolvePaddingOf(p, undefined)
    }, carousel + fallback));
});