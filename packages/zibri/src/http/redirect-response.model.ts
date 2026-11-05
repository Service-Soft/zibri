import { Property } from '../entity/decorators/property.decorator';
import { SelfDescribing } from '../types/self-describing.type';

/**
 * A response that sends the caller on to another url.
 *
 * The status comes from the route's `Response.redirect` declaration.
 */
export class RedirectResponse implements SelfDescribing {

    /**
     * What this is, as a value, so that it is still known after the response has been through json
     * and back. Not part of what a caller is answered with.
     */
    // written down rather than left to the prototype - for the reason `HtmlResponse` gives
    @Property.string({ exclude: true })
    readonly className: 'RedirectResponse' = 'RedirectResponse';

    private constructor(
        /**
         * Where the caller is sent.
         */
        readonly url: string
    ) {}

    /**
     * Creates a response that sends the caller to the given url.
     * @param url - Where to send the caller.
     * @returns A new RedirectResponse.
     */
    static to(url: string | URL): RedirectResponse {
        return new this(url.toString());
    }
}

/**
 * Whether the given value is a redirect response.
 *
 * Judged by its `className`, so that a response that has been through json and back is still
 * recognized as one.
 * @param value - The value to judge.
 * @returns True when the value is a redirect response.
 */
export function isRedirectResponse(value: unknown): value is RedirectResponse {
    return typeof value === 'object' && value != undefined
        && (value as Partial<RedirectResponse>).className === 'RedirectResponse';
}