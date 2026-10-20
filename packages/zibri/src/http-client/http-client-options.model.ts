import { HttpClientCircuitBreakerOptions } from './http-client-circuit-breaker-options.model.ts';
import { FileSize } from '../entity/models/file-property-metadata.model.ts';

/**
 * What a request is sent over.
 *
 * Node's `fetch` is undici's, and a dispatcher is the one thing it takes that decides *how* the
 * connection is made rather than what is sent over it - so a proxy, a CA bundle, a client
 * certificate, keep-alive and per-host pooling are all one of these. Zibri does not build them: an
 * `Agent`, a `ProxyAgent` or an `EnvHttpProxyAgent` comes from the deployment's own `undici`, and
 * this is where it is handed over.
 *
 * **Described here rather than imported from `undici-types`**, which is the version undici's own
 * `Dispatcher` would have dragged in. Naming that package means naming a *version* of it, and there
 * is no version to name: `undici-types` reaches a project through `@types/node`, whose major decides
 * which one - measured across this repository's own workspaces, three different `@types/node`
 * versions brought undici-types 6, 7 and 8. A declaration written against any one of them is a
 * declaration the other two cannot satisfy, so the option would have refused the very `ProxyAgent`
 * it exists to accept, depending on nothing more than the consumer's `@types/node`.
 *
 * The framework never calls a dispatcher - it forwards one to `fetch` - so carrying it is all this
 * has to describe. Every real dispatcher satisfies it, whichever undici built it.
 */
export type HttpClientDispatcher = {
    /**
     * Sends one request. Called by undici, never by Zibri.
     */
    dispatch: (options: never, handler: never) => boolean
};

/**
 * Options that apply to every request the http client sends, unless the request says otherwise.
 */
export type HttpClientOptions = {
    /**
     * How long a request may take, from sending it to having read the answer.
     *
     * Covers the body rather than only the headers: an upstream that answers instantly and then
     * dribbles its body forever is the case a deadline exists for, and one that ends at the first
     * line of the response does not end it.
     * @default 5000
     */
    defaultTimeoutMs: number,
    /**
     * The most a response body may buffer when the request declared no response model to derive a
     * size from.
     *
     * Large enough that no ordinary json answer meets it, small enough that an upstream which is
     * hostile or simply broken cannot spend the process's memory. Counted as the body arrives, so a
     * body over the limit is stopped rather than downloaded and then refused.
     *
     * A request that declares a `responseBody` derives its limit from that instead - it is the size of
     * the thing that was actually asked for. A body genuinely larger than this wants a stream, which
     * buffers nothing and is not capped.
     * @default '10mb'
     */
    defaultMaxResponseSize: FileSize,
    /**
     * What every outbound request is sent over, unless the request names its own.
     *
     * This is where a corporate egress proxy, a custom CA bundle and mutual tls are configured -
     * all three are how a {@link HttpClientDispatcher} is built, and none of them can be expressed
     * any other way. Leaving it unset uses node's own, which is what an unconfigured `fetch` does.
     *
     * Scoped to this client rather than installed with `setGlobalDispatcher`, deliberately: a
     * global dispatcher changes where *every* library in the process sends its traffic, and a
     * framework has no business deciding that on an application's behalf.
     * @default undefined
     */
    dispatcher?: HttpClientDispatcher,
    /**
     * When requests to an origin that keeps failing stop being sent, or false to always send them.
     * @default { failuresToOpen: 5, openForMs: 30000 }
     */
    circuitBreaker: HttpClientCircuitBreakerOptions | false
};

/**
 * The options a deployment provides, with everything it does not name left to the defaults.
 */
export type HttpClientOptionsInput = Partial<HttpClientOptions>;