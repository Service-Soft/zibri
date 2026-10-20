import { Property } from '../entity/decorators/property.decorator.ts';
import { SelfDescribing } from '../types/self-describing.type.ts';

/**
 * A response that sends the caller on to another url.
 *
 * The status comes from the route's `Response.redirect` declaration.
 */
export class RedirectResponse implements SelfDescribing {

    /**
     * What this is, written down rather than left to the prototype - for the reason `HtmlResponse`
     * gives.
     */
    @Property.string({ exclude: true })
    readonly className: 'RedirectResponse' = 'RedirectResponse' as const;

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
 * By what it says it is rather than by `instanceof`, for the reason `isHtmlResponse` gives.
 * @param value - The value to judge.
 * @returns True when the value is a redirect response.
 */
export function isRedirectResponse(value: unknown): value is RedirectResponse {
    return typeof value === 'object' && value != undefined
        && (value as Partial<RedirectResponse>).className === 'RedirectResponse';
}