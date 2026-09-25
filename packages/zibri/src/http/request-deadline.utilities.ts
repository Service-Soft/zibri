import { HandlerTimeout } from './handler-timeout.type';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GatewayTimeoutError } from '../error-handling/errors/gateway-timeout.error';
import { InternalError } from '../error-handling/internal-error.model';
import { $ts } from '../localization/translate.function';
import { LoggerInterface } from '../logging/logger.interface';

/**
 * Bounds how long a handler may take, whichever kind of request it is answering.
 */
export abstract class RequestDeadlineUtilities {
    /**
     * Runs a handler with the deadline it was given.
     *
     * The clock covers the handler alone. Writing the response is not part of it, so a stream, a
     * download and a page of events are outside a deadline by being what they are rather than by
     * declaring an exemption.
     *
     * Nothing is stopped when the deadline passes: a promise cannot be cancelled and whatever the
     * handler is waiting for does not know it is being waited for. What happens is that the caller
     * is answered with a 504 and `context.signal` fires, so work that takes a signal can end itself.
     * @param context - The request the handler is running in.
     * @param timeoutInMs - How long it is allowed, already resolved from the route, its controller
     * and the application.
     * @param fn - The handler.
     * @returns Whatever the handler returned, when it returned it in time.
     * @throws A `GatewayTimeoutError` when it did not.
     */
    static async resolveWithinDeadline<T>(
        context: HttpRequestContext | WebsocketRequestContext,
        timeoutInMs: HandlerTimeout,
        fn: () => Promise<T>
    ): Promise<T> {
        if (timeoutInMs === 'none') {
            return await fn();
        }

        let timer: NodeJS.Timeout | undefined = undefined;
        const deadline: Promise<never> = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => {
                    // one error for both: it is what the caller is answered with, and it is what
                    // every wait inside this request that gives up now reports. A lease that stopped
                    // queueing and an upstream call that was let go both failed for this reason, and
                    // inventing an error each would say less
                    const error: GatewayTimeoutError = new GatewayTimeoutError(
                        $ts`This took longer than the ${timeoutInMs}ms it is allowed.`
                    );
                    context.abandon(error);
                    reject(error);
                },
                timeoutInMs
            );
        });

        // taken while the request is still running rather than where it is written. Work that was
        // abandoned can outlast the application it belongs to - a suite tearing its server down is
        // the ordinary way to see that - and a container that has been released has no logger left
        // to hand out
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);

        // started before the race so that a handler which rejects after losing it has a handler of
        // its own. `Promise.race` drops its loser, and a dropped rejection is an unhandled one -
        // which ends the process, over work whose caller was answered correctly a second ago
        const work: Promise<T> = fn();
        void this.reportFailureAfterDeadline(logger, context, work);

        try {
            return await Promise.race([work, deadline]);
        }
        finally {
            clearTimeout(timer);
        }
    }

    /**
     * Writes the only record there will be of work that failed after it was abandoned.
     *
     * The response is long gone by then, so the error handler cannot run and nothing else reports
     * that the handler which was already answered for went on to fail.
     * @param logger - The logger, taken while the request was still running.
     * @param context - The request the handler is running in.
     * @param work - The handler's promise.
     */
    private static async reportFailureAfterDeadline<T>(
        logger: LoggerInterface,
        context: HttpRequestContext | WebsocketRequestContext,
        work: Promise<T>
    ): Promise<void> {
        try {
            await work;
        }
        catch (error) {
            if (!context.signal.aborted) {
                // the race is reporting this one, and the error handler is about to answer with it
                return;
            }
            if (this.isDeadlineComingBack(error, context.signal.reason)) {
                return;
            }
            logger.error(new InternalError('A request handler failed after its deadline had been answered.', { cause: error }));
        }
    }

    /**
     * Whether a handler stopped because it was told to rather than because something went wrong.
     *
     * Everything inside a request that gives up waiting fails with the deadline's own error, so a
     * handler that passed the signal on ends up throwing it back out. That is the deadline arriving
     * where it started rather than a second thing going wrong, and the 504 has already reported it -
     * logging it again would put an error beside every timeout that did its job.
     * @param error - What the handler failed with.
     * @param reason - What the deadline aborted with.
     * @returns True when the failure is the deadline itself.
     */
    private static isDeadlineComingBack(error: unknown, reason: unknown): boolean {
        // by cause as well as by identity, because a caller is free to wrap what it caught
        let current: unknown = error;
        while (current != undefined) {
            if (current === reason) {
                return true;
            }
            if (!(current instanceof Error)) {
                return false;
            }
            current = current.cause;
        }
        return false;
    }
}