import { DiToken } from '../di/models/di-token.model.ts';

/**
 * The base context that any context needs to extend from.
 */
export abstract class BaseContext<T> {
    abstract readonly type: T;
    /**
     * The cached token values.
     */
    protected readonly tokenValues: Map<string, unknown> = new Map();
    /**
     * The request scoped values that have been built while handling this.
     *
     * Lives here rather than in the container because this is the thing whose lifetime they share:
     * the context is dropped when the request is done and takes them with it, so nothing has to
     * remember to clear them.
     */
    readonly scopedInstances: Map<DiToken<unknown>, unknown> = new Map();
    /**
     * Fires when the request is no longer worth working on.
     *
     * Here rather than on the one context that currently fires it, so that a service several calls
     * below a handler reads it the same way whatever it was reached from.
     */
    protected readonly abortController: AbortController = new AbortController();

    constructor() {}

    /**
     * Fires when this request is no longer worth working on, and never for a request that is simply
     * finished.
     *
     * A http route that runs out of the time it was given is answered without its handler, and the
     * handler is not stopped by that - nothing can stop code that is waiting for something. This is
     * how it finds out, and how whatever it is waiting for can be told: pass it on to a query, an
     * http call, or anything else taking an `AbortSignal`.
     *
     * A websocket request has nothing that bounds it, so its signal does not fire.
     * @returns The signal of this request.
     */
    get signal(): AbortSignal {
        return this.abortController.signal;
    }

    /**
     * Records that nothing is waiting for this request any more.
     *
     * Fires `signal`, which is everything still running inside the request finding out. What called
     * this differs - a handler out of time, a client that hung up - and the reason is how anything
     * that gives up says which it was.
     * @param reason - What anything giving up because of this should fail with, so that every
     * abandoned wait reports the same thing rather than each inventing its own error.
     */
    abandon(reason: Error): void {
        this.abortController.abort(reason);
    }
}