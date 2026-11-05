import { Header } from './header.type';
import { HttpStatus } from './http-status.enum';
import { Property } from '../entity/decorators/property.decorator';
import { SelfDescribing } from '../types/self-describing.type';

/**
 * What a json response answers with beside its body.
 */
export type JsonResponseOptions = {
    /**
     * The headers to answer with, such as an `etag` or a `location`.
     */
    headers?: Partial<Record<Header, string>>,
    /**
     * The status to answer with, in place of the one the route's `Response` declaration gives, such as
     * `201` when the request created what it named and `200` when it replaced it.
     */
    status?: HttpStatus
};

/**
 * A json body, answered with headers or a status of its own.
 *
 * Everything else is answered as for a body returned as it is: the status comes from the route's
 * `Response` declaration unless one is given, and the json type from what the request accepts. A
 * route answering a `GET` with an `etag` answers a request whose `If-None-Match` names it with `304`.
 */
export class JsonResponse<T> implements SelfDescribing {

    /**
     * What this is, as a value, so that it is still known after the response has been through json
     * and back. Not part of what a caller is answered with.
     */
    // written down rather than left to the prototype - for the reason `HtmlResponse` gives
    @Property.string({ exclude: true })
    readonly className: 'JsonResponse' = 'JsonResponse';

    private constructor(
        /**
         * The body.
         */
        readonly body: T,
        /**
         * The headers to answer with.
         */
        readonly headers: Partial<Record<Header, string>>,
        /**
         * The status to answer with, or undefined for the one the route declares.
         */
        readonly status: HttpStatus | undefined
    ) {}

    /**
     * Creates a response answering with the given body, headers and status.
     * @param body - The body.
     * @param options - The headers and the status to answer with.
     * @returns A new JsonResponse.
     */
    static of<T>(body: T, options: JsonResponseOptions): JsonResponse<T> {
        return new this(body, options.headers ?? {}, options.status);
    }
}

/**
 * Whether the given value is a json response.
 *
 * Judged by its `className`, so that a response that has been through json and back is still
 * recognized as one.
 * @param value - The value to judge.
 * @returns True when the value is a json response.
 */
export function isJsonResponse(value: unknown): value is JsonResponse<unknown> {
    return typeof value === 'object' && value != undefined && 'className' in value && value.className === 'JsonResponse';
}