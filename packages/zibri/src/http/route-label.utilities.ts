import { HttpRequest } from './http-request.model';
import { HttpResponse } from './http-response.model';

/**
 * The label every request that matched no route shares.
 *
 * One value rather than one per url, which is the difference between a bounded set of names and an
 * unbounded one - anybody can ask for a path that does not exist, and asking for a million of them
 * must not cost a million of anything.
 */
export const unmatchedRouteLabel: string = '<unmatched>';

/**
 * The status for a response the client abandoned before it was written.
 *
 * The code proxies conventionally use for the same situation. Not a status any server ever sends,
 * which is what makes it unambiguous in a dashboard or a trace.
 */
export const clientClosedRequestStatus: number = 499;

/**
 * Names what a finished request was, in terms that stay bounded however much traffic arrives.
 *
 * Shared by everything that reports per request and has to name the request without naming the
 * caller's input: metrics label their series with this, and a span is named by it.
 */
export abstract class RouteLabelUtilities {
    /**
     * What route was asked for.
     *
     * The route *template*, never the url that was requested. Both readers keep every distinct value
     * they have seen - a metrics registry holds a series per label set forever, and a tracing backend
     * indexes span names - so a value taken from the url lets anybody mint unlimited ones by varying
     * it. `/health?x=1`, `/health?x=2` and so on is a few lines of shell, needs no credentials, and
     * ends with the process out of memory and the monitoring backend alongside it. Ordinary traffic
     * gets there too, just more slowly, because an id in a path is a new value every time.
     *
     * A request that matched no route has no template to report, and reporting its url instead would
     * reopen exactly the hole this closes - so all of them share one value. That is also the useful
     * shape: what matters about a scan for admin panels is the rate, not which paths it guessed.
     * @param req - The request.
     * @returns The template, or the shared value for a request that matched nothing.
     */
    static resolveRouteLabel(req: HttpRequest): string {
        // express types this as `any`, so it is narrowed rather than trusted
        const matched: unknown = req.route;
        if (typeof matched !== 'object' || matched == undefined || !('path' in matched)) {
            return unmatchedRouteLabel;
        }
        const path: unknown = matched.path;
        if (typeof path !== 'string') {
            return unmatchedRouteLabel;
        }
        return `${req.baseUrl}${path}`;
    }

    /**
     * How the request ended.
     *
     * A response the client abandoned carries whatever status was set before it left, which is
     * usually the 200 nothing ever wrote - reporting that would report an abandoned request as a
     * success.
     * @param res - The response.
     * @returns The status, or 499 for a response nobody stayed to read.
     */
    static resolveStatusCode(res: HttpResponse): number {
        return res.writableFinished ? res.statusCode : clientClosedRequestStatus;
    }
}