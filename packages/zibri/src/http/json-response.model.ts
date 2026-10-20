import { Header } from './header.type.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { SelfDescribing } from '../types/self-describing.type.ts';

/**
 * What a json response answers with beside its body.
 */
export type JsonResponseOptions = {
    /**
     * The headers to answer with, such as an `etag` or a `location`.
     */
    headers: Partial<Record<Header, string>>
};

/**
 * A json body, answered with headers of its own.
 *
 * Everything else is answered as for a body returned as it is: the status comes from the route's
 * `Response` declaration, and the json type from what the request accepts. A route answering a
 * `GET` with an `etag` answers a request whose `If-None-Match` names it with `304`.
 */
export class JsonResponse<T> implements SelfDescribing {

    /**
     * What this is, written down rather than left to the prototype - for the reason `HtmlResponse`
     * gives.
     */
    @Property.string({ exclude: true })
    readonly className: 'JsonResponse' = 'JsonResponse' as const;

    private constructor(
        /**
         * The body.
         */
        readonly body: T,
        /**
         * The headers to answer with.
         */
        readonly headers: Partial<Record<Header, string>>
    ) {}

    /**
     * Creates a response answering with the given body and headers.
     * @param body - The body.
     * @param options - The headers to answer with.
     * @returns A new JsonResponse.
     */
    static of<T>(body: T, options: JsonResponseOptions): JsonResponse<T> {
        return new this(body, options.headers);
    }
}

/**
 * Whether the given value is a json response.
 *
 * By what it says it is rather than by `instanceof`, for the reason `isHtmlResponse` gives.
 * @param value - The value to judge.
 * @returns True when the value is a json response.
 */
export function isJsonResponse(value: unknown): value is JsonResponse<unknown> {
    return typeof value === 'object' && value != undefined && 'className' in value && value.className === 'JsonResponse';
}