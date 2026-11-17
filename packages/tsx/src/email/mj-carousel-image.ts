import { CarouselImagesContext } from './carousel.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjCarouselImage}.
 */
export type MjCarouselImageProps = {
    /**
     * The url of the image.
     */
    src?: string,
    /**
     * The alternative text.
     */
    alt?: string,
    /**
     * The link the image opens.
     */
    href?: string,
    /**
     * The `rel` of the link.
     */
    rel?: string,
    /**
     * Where the thumbnail's link opens. Defaults to `_blank`.
     */
    target?: string,
    /**
     * The title of the image.
     */
    title?: string,
    /**
     * The url of the thumbnail, the image's own when unset.
     */
    thumbnailsSrc?: string,
    /**
     * The border radius of the image, the carousel's when unset.
     */
    borderRadius?: string,
    /**
     * The border of the thumbnail, the carousel's when unset.
     */
    tbBorder?: string,
    /**
     * The border radius of the thumbnail, the carousel's when unset.
     */
    tbBorderRadius?: string,
    /**
     * A CSS class added to the image, and with `-thumbnail` after it to the thumbnail.
     */
    cssClass?: string
};

/**
 * One image of a carousel. Mirrors MJML's `mj-carousel-image`: it renders nothing where it stands, and the
 * `MjCarousel` around it writes it as a slide, a thumbnail and the input choosing it.
 */
export const MjCarouselImage: TsxComponent<MjCarouselImageProps> = defineEmailComponent<MjCarouselImageProps>(
    'MjCarouselImage',
    (props, $ssr) => {
        $ssr.useContext(CarouselImagesContext)?.push(withDefaults($ssr, 'MjCarouselImage', props));

        return $ssr.raw('');
    }
);