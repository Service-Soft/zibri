import path from 'node:path';

import { BASE_PATH } from '../base-path';

/**
 * Where the images the pages show are served.
 */
export abstract class ImageUtilities {
    /**
     * The address of an image a page shows, which the site serves from beside the pages.
     * @param src - What the image names, such as `./assets-explorer.png`.
     * @param from - The file of the page showing it.
     * @returns The address.
     */
    static resolveImage(src: string, from: string): string {
        const besidePage: boolean = src.startsWith('./') || src.startsWith('../');
        return besidePage ? `${BASE_PATH}/images/${path.posix.normalize(path.posix.join(path.posix.dirname(from), src))}` : src;
    }
}