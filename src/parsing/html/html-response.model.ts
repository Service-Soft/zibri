import { Readable } from 'stream';

import { buildCspOptions, CspOptions } from './csp-options.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DeepPartial } from '../../types/deep-partial.type';

/**
 * Additional options for a html response.
 */
export type HtmlResponseOptions = {
    /**
     * The configuration for CSP headers.
     * Can either be false to not set any, true to set the default CSP headers or a custom configuration.
     */
    csp?: boolean | DeepPartial<CspOptions>
};

/**
 * A html response.
 */
export class HtmlResponse {

    private constructor(readonly data: Readable | string, readonly csp: boolean | CspOptions) {}

    /**
     * Creates the response from the given html string.
     * @param html - The html value as a string.
     * @param options - Additional options like eg. CSP headers.
     * @returns A new HtmlResponse.
     */
    static fromString(html: string, options?: HtmlResponseOptions): HtmlResponse {
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS));
        return new this(html, csp);
    }

    /**
     * Creates the response from the given html stream.
     * @param stream - The html value as a stream.
     * @param options - Additional options like eg. CSP headers.
     * @returns A new HtmlResponse.
     */
    static fromStream(stream: Readable, options?: HtmlResponseOptions): HtmlResponse {
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS));
        return new this(stream, csp);
    }
}