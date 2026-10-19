/**
 * When the http client stops calling an origin that keeps failing, and for how long.
 *
 * A failure is a request that got no answer, or one answered with 500, 502, 503 or 504. Any other
 * answer counts as the origin being up.
 */
export type HttpClientCircuitBreakerOptions = {
    /**
     * How many failures in a row open the circuit of an origin, after which its requests fail at once
     * with a `CircuitOpenError`.
     * @default 5
     */
    failuresToOpen: number,
    /**
     * How long an open circuit refuses requests, in milliseconds. After that one request is let
     * through: an answer closes the circuit, a failure opens it again.
     * @default 30000
     */
    openForMs: number
};