import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { toKebabCase } from '../../utilities/to-kebab-case.function';

/**
 * The possible CSP sources/values for the CSP headers.
 */
export type CspSource = '\'self\''
    | '\'none\''
    | '\'unsafe-hashes\''
    | `\'sha256-${string}\'`
    | '\'unsafe-inline\''
    | '\'unsafe-eval\''
    | `\'nonce-${string}\'`
    | 'data:'
    | `https://${string}`
    | `http://${string}`;

/**
 * Definition of CSP options.
 */
export type CspOptions = {
    /**
     * Fallback for all fetch destinations that are not explicitly covered by a more specific directive.
     */
    defaultSrc: CspSource[],
    /**
     * Restricts the base URL used to resolve relative URLs on the page.
     */
    baseUri: CspSource[],
    /**
     * Restricts the sources from which plugins such as <object>, <embed>, and <applet> may load.
     */
    objectSrc: CspSource[],
    /**
     * Restricts the URLs that can be used as form submission targets.
     */
    formAction: CspSource[],
    /**
     * Restricts which origins may embed this document in frames, iframes, or objects.
     */
    frameAncestors: CspSource[],
    /**
     * Restricts valid sources for JavaScript.
     */
    scriptSrc: CspSource[],
    /**
     * Restricts inline script event handlers and similar script attributes.
     */
    scriptSrcAttr: CspSource[],
    /**
     * Restricts valid sources for stylesheets and inline style usage.
     */
    styleSrc: CspSource[],
    /**
     * Restricts the origins from which images, icons, and similar media-like assets may be loaded.
     */
    imgSrc: CspSource[],
    /**
     * Restricts the origins from which fonts may be loaded.
     */
    fontSrc: CspSource[],
    /**
     * Restricts the endpoints that the document may connect to via fetch, XHR, WebSocket, EventSource, and similar APIs.
     */
    connectSrc: CspSource[],
    /**
     * Restricts the origins from which audio and video media may be loaded.
     */
    mediaSrc: CspSource[]
};

/**
 * Builds csp options from the given input and default options.
 * @param options - The input options.
 * @param defaultValue - The default values to fall back to.
 * @returns Valid CSP options.
 */
export function buildCspOptions(
    options: DeepPartial<CspOptions> | boolean | undefined,
    defaultValue: boolean | CspOptions
): CspOptions | boolean {
    if (typeof options === 'boolean') {
        return options;
    }
    if (options == undefined) {
        return defaultValue;
    }
    return {
        ...inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS),
        ...options
    };
}

/**
 * Builds the Content-Security-Policy headers from the given options.
 * @param options - The CSP options to build the headers from.
 * @returns The CSP header as a string.
 */
export function buildCspHeaders(options: CspOptions): string {
    return ObjectUtilities.entries(options)
        .map(([key, value]) => {
            if (!value?.length) {
                return undefined;
            }
            return `${toKebabCase(key)} ${value.join(' ')}`;
        })
        .filter(Boolean)
        .join('; ');
}