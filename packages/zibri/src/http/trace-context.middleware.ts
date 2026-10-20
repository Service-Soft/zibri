import { RequestHandler } from 'express';

import { HttpRequest } from './http-request.model.ts';
import { HttpResponse } from './http-response.model.ts';
import { KnownHeader } from './known-header.enum.ts';
import { RouteLabelUtilities } from './route-label.utilities.ts';
import { TraceContextUtilities } from '../tracing/trace-context.utilities.ts';
import { TraceSpanContext } from '../tracing/trace-span-context.model.ts';
import { TraceSpanKind } from '../tracing/trace-span-kind.enum.ts';
import { TraceSpanStatus } from '../tracing/trace-span-status.enum.ts';
import { TraceSpanInterface } from '../tracing/trace-span.interface.ts';
import { TracingUtilities } from '../tracing/tracing.utilities.ts';

/**
 * Puts every request into a trace, records it as a span, and answers with the trace it ended up in.
 *
 * Continued from the caller when it sent a `traceparent`, so a request crossing several services
 * reads as one story rather than as three unrelated ones. Started here when it did not, because a
 * trace only an upstream service can supply is missing exactly where a request arrived from outside.
 *
 * A middleware rather than a lazily resolved token: a request nothing logged would otherwise have no
 * trace at all - including on its own response, which is where a caller reads the one to quote.
 *
 * The resolved context is written back onto the request headers, which is where everything
 * downstream looks, so a trace this application started is indistinguishable from one it was handed
 * - including for the access log, which runs once the response has closed and has no context left
 * to ask.
 * @returns The middleware.
 */
export function traceContextMiddleware(): RequestHandler {
    return (expressRequest, res, next) => {
        // express types its own request loosely; the metrics and access log middleware make the same
        // narrowing for the same reason
        const req: HttpRequest = expressRequest as HttpRequest;
        const incoming: TraceSpanContext | undefined = TraceContextUtilities.findSpanContext(req.headers);

        const span: TraceSpanInterface = TracingUtilities.startSpan(req.method, {
            kind: TraceSpanKind.SERVER,
            parent: incoming,
            attributes: {
                'http.request.method': req.method,
                'url.path': req.path,
                'url.scheme': req.protocol,
                'client.address': req.ip ?? req.socket?.remoteAddress,
                'user_agent.original': req.headers[KnownHeader.USER_AGENT]
            }
        });

        Object.assign(req.headers, TraceContextUtilities.resolveHeaders(span.context));
        // the standard's own name for telling a caller which trace answered them. A browser's
        // network tab and a ticket both read it off here
        res.setHeader(KnownHeader.TRACERESPONSE, TraceContextUtilities.resolveTraceparent(span.context));

        // 'close' rather than 'finish', for the reason the metrics middleware gives: finish only
        // fires once a response has been written in full, so a client that hung up and a request
        // that died halfway would leave a span that never ended
        res.on('close', () => endRequestSpan(span, req, res));

        // next() inside the scope rather than after it: express calls the rest of the pipeline from
        // here, so everything that answers this request runs inside the span it belongs to
        TracingUtilities.runWithSpan(span, next);
    };
}

/**
 * Finishes the span of a request that is over.
 *
 * Named here rather than written inline, because what a request turned out to be is only knowable
 * once it is: the route that matched, the status it answered with, and whether the caller stayed to
 * read it.
 * @param span - The span of the request.
 * @param req - The request.
 * @param res - The response.
 */
function endRequestSpan(span: TraceSpanInterface, req: HttpRequest, res: HttpResponse): void {
    const route: string = RouteLabelUtilities.resolveRouteLabel(req);
    const status: number = RouteLabelUtilities.resolveStatusCode(res);

    // the route rather than the url, for the reason the metrics service records the route: a span
    // name is something to group by, and a name taken from the url groups nothing
    span.updateName(`${req.method} ${route}`);
    span.recordAttributes({
        'http.route': route,
        'http.response.status_code': status
    });

    // what the application did wrong rather than what the caller asked wrongly: a 404 is a correct
    // answer to a bad request, and a trace that paints every one of them red hides the 500s
    span.end(status >= 500 ? TraceSpanStatus.ERROR : TraceSpanStatus.UNSET);
}