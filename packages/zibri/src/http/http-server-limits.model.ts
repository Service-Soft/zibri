import { HandlerTimeout } from './handler-timeout.type';

/**
 * How long the http server waits for a client that has stopped making progress, and how much it
 * accepts from one before a route sees the request.
 *
 * Every timeout bounds a socket that is doing nothing. A connection nobody closes costs a file
 * descriptor and a slot in whatever the process is willing to hold open, which is what makes a
 * request that never finishes arriving a way to take a server down without sending anything.
 */
export type HttpServerLimits = {
    /**
     * How long a request may take to arrive in full, from the first byte to the last.
     *
     * Node's own default is five minutes, which is a long time to hold a socket for a body that may
     * never come.
     */
    requestInMs: number,
    /**
     * How long the headers alone may take to arrive.
     *
     * Shorter than `requestInMs` on purpose: a body can legitimately be large and slow, a set of
     * headers cannot. This is the one that ends a client sending a header every few seconds forever.
     */
    headersInMs: number,
    /**
     * How long an idle keep alive connection is kept before it is closed.
     *
     * Raise this above the idle timeout of whatever sits in front of the application. A proxy that
     * reuses a connection the server closed in the same moment has nothing to answer the request
     * with, and reports it as a gateway error that no log on this side explains.
     */
    keepAliveInMs: number,
    /**
     * How long a route handler has to produce a result, for every route that does not say otherwise.
     *
     * The three above bound a client; this one bounds your own code. A request that has arrived in
     * full has satisfied all of them, and nothing stops the handler it reached from running for as
     * long as whatever it is waiting for takes.
     *
     * A route declares its own with `timeoutInMs`, and `'none'` - here or on a route - means the
     * handler is given as long as it needs.
     */
    handlerInMs: HandlerTimeout,
    /**
     * How many headers a request may carry. One with more is answered `431`.
     */
    maxHeaderCount: number,
    /**
     * How many bytes the headers of a request may take up together. Headers that take more are
     * answered `431`.
     */
    maxHeaderSizeInBytes: number
};