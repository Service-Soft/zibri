/**
 * The key that makes a request safe to send more than once: the server answers a repeated key like
 * the first request that carried it, instead of doing the work again.
 *
 * `true` generates one for the call, a string is the key itself, and an object names the header a
 * provider reads it from, eg. `{ value: order.id, header: 'PayPal-Request-Id' }`. The key is the same
 * on every attempt of the call, and is sent as `Idempotency-Key` unless a header is named.
 */
export type HttpClientIdempotencyKey = true | string | {
    /**
     * The key, or undefined to generate one for the call.
     */
    value?: string,
    /**
     * The header the key is sent as.
     * @default 'Idempotency-Key'
     */
    header?: string
};