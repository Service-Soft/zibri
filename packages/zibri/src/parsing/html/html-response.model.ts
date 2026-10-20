import { Readable } from 'stream';

import { buildCspOptions, CspOptions, CspOptionsInput } from './csp-options.model.ts';
import { type HttpRequestContext } from '../../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model.ts';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { SelfDescribing } from '../../types/self-describing.type.ts';

/**
 * Additional options for a html response.
 */
export type HtmlResponseOptions = {
    /**
     * The configuration for CSP headers.
     * Can either be false to not set any, true to set the default CSP headers or a custom configuration.
     */
    csp?: boolean | CspOptionsInput
};

/**
 * A html response.
 */
export class HtmlResponse implements SelfDescribing {

    /**
     * What this is, written down rather than left to the prototype.
     *
     * Whatever decides that a handler returned html has to keep deciding it after the value has been
     * somewhere that json is the only thing it could be - a shared cache, most obviously. A class is
     * exactly what does not survive that trip: the values come back and the prototype does not, so
     * `instanceof` answers no for a response that is one. This does survive, because it is a value.
     *
     * Excluded, so that it stays wiring: it is not part of what a caller is answered with.
     */
    @Property.string({ exclude: true })
    readonly className: 'HtmlResponse' = 'HtmlResponse' as const;

    private constructor(
        readonly data: Readable | string,
        readonly csp: boolean | CspOptions,
        /**
         * The csp nonce of the request the html was created in, which is the one its tags carry.
         */
        readonly nonce: string | undefined
    ) {}

    /**
     * Creates the response from the given html string.
     * @param html - The html value as a string.
     * @param options - Additional options like eg. CSP headers.
     * @returns A new HtmlResponse.
     */
    static fromString(html: string, options?: HtmlResponseOptions): HtmlResponse {
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS));
        return new this(html, csp, this.resolveCurrentNonce());
    }

    /**
     * Creates the response from the given html stream.
     * @param stream - The html value as a stream.
     * @param options - Additional options like eg. CSP headers.
     * @returns A new HtmlResponse.
     */
    static fromStream(stream: Readable, options?: HtmlResponseOptions): HtmlResponse {
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS));
        return new this(stream, csp, this.resolveCurrentNonce());
    }

    private static resolveCurrentNonce(): string | undefined {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        return context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
    }
}

/**
 * Whether the given value is a html response.
 *
 * By what it says it is rather than by `instanceof`, so that a response that has been through json
 * and back - a shared cache is the case that does it - is still recognized as one. The prototype
 * does not survive that trip and the value does.
 * @param value - The value to judge.
 * @returns True when the value is a html response.
 */
export function isHtmlResponse(value: unknown): value is HtmlResponse {
    return typeof value === 'object' && value != undefined
        && (value as Partial<HtmlResponse>).className === 'HtmlResponse';
}