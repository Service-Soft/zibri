import type { MjCarouselImageProps } from './mj-carousel-image';
import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * The images the `MjCarousel` around an image collects, each as it records itself, or undefined for an image
 * rendered on its own.
 */
export const CarouselImagesContext: RenderContext<MjCarouselImageProps[] | undefined>
    = createContext<MjCarouselImageProps[] | undefined>(undefined);