import { NextFunction } from 'express';

import { ErrorPageTemplate, GlobalErrorHandler } from './error-handler.model.ts';
import { ErrorResponseBody } from './error-response-body.model.ts';
import { ErrorUtilities } from './error.utilities.ts';
import { CustomBodyHttpError } from './errors/custom-body-http.error.ts';
import { InternalError } from './internal-error.model.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { XmlWriterUtilities } from '../document/xml-writer.utilities.ts';
import { HttpRequest } from '../http/http-request.model.ts';
import { HttpResponse } from '../http/http-response.model.ts';
import { HttpError } from './errors/http.error.ts';
import { HttpStatus } from '../http/http-status.enum.ts';
import { JsonMimeType } from '../http/json-mime-type.type.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';
import { TracingUtilities } from '../tracing/tracing.utilities.ts';
import { TsxUtilities } from '../tsx/tsx.utilities.ts';
import { GlobalError } from './errors/global.error.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { MethodNotAllowedError } from './errors/method-not-allowed.error.ts';
import { TooManyRequestsError } from './errors/too-many-requests.error.ts';
import { NumberUtilities } from '../utilities/number.utilities.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';

/**
 * The default error handler implementation of Zibri.
 * @param error - The error that was caught.
 * @param req - The http request.
 * @param res - The http response.
 * @param next - The express next function.
 */
export const errorHandler: GlobalErrorHandler = async (error: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    const httpError: HttpError = ErrorUtilities.toHttpError(error);
    handleLogging(error, httpError);
    handleRateLimitHeaders(httpError, res);
    handleAllowHeader(httpError, res);

    // the body depends on what the request accepts, so a cache in front of this has to keep them apart
    res.vary(KnownHeader.ACCEPT);

    if (httpError instanceof CustomBodyHttpError) {
        const accepted: string | false = req.accepts(httpError.mimeTypes);
        const mimeType: JsonMimeType = httpError.mimeTypes.find(m => m === accepted) ?? httpError.mimeTypes[0] ?? MimeType.JSON;
        for (const [name, value] of ObjectUtilities.entries(httpError.headers)) {
            if (value != undefined) {
                res.setHeader(name, value);
            }
        }
        res.status(httpError.status).type(mimeType)
            .send(JsonUtilities.stringify(httpError.body));
        return;
    }

    const preferred: string | false = req.accepts(MimeType.JSON, MimeType.XML, MimeType.HTML);
    // the trace the response already names in a header, repeated where somebody copying an error
    // into a ticket will actually see it - which is the only place it does any good
    const body: ErrorResponseBody = {
        status: httpError.status,
        name: httpError.name,
        message: httpError.message,
        paragraphs: httpError.paragraphs,
        traceId: TracingUtilities.getCurrentTraceContext()?.traceId
    };

    if (preferred === MimeType.XML) {
        await sendXml(res, body);
        return;
    }

    // a caller that accepts none of them is answered in json anyway, deliberately. The alternative is to
    // refuse the refusal, which leaves somebody debugging a request that failed with nothing saying
    // why - and a route asked for a representation it cannot produce has already been told so by the
    // 406 the router raised, which is one of the errors that would arrive here
    if (preferred !== 'html' && preferred !== 'text/html') {
        res.status(httpError.status).json(body);
        return;
    }

    const template: ErrorPageTemplate | undefined = inject(ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE);
    if (!template) {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        logger.warn('Could not find a template for the error page.');
        logger.warn(
            'Either provide ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE or your own error handler (ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER).'
        );
        logger.warn('Falling back to returning a json response');
        res.status(httpError.status).json(body);
        return;
    }

    try {
        const html: string = TsxUtilities.renderPage(template, { error: httpError });
        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        res.status(httpError.status).send(html);
    }
    catch {
        res.status(httpError.status).json(body);
    }
};

/**
 * Answers with the error as an xml document.
 * @param res - The response to write.
 * @param body - The error.
 */
async function sendXml(res: HttpResponse, body: ErrorResponseBody): Promise<void> {
    let xml: string;
    try {
        xml = await XmlWriterUtilities.write(ErrorResponseBody, body);
    }
    catch (error) {
        // a message holding a character xml cannot carry at all. The same error in json still tells
        // the caller why its request failed, which answering with nothing would not
        inject(ZIBRI_DI_TOKENS.LOGGER).error(new InternalError('Could not write an error response as xml.', { cause: error }));
        res.status(body.status).json(body);
        return;
    }
    res.status(body.status).type(MimeType.XML)
        .send(xml);
}

/**
 * Names the methods a path does answer, which is what makes a 405 worth reading.
 *
 * The status alone says the request was wrong without saying what would have been right, and the one
 * thing a caller can do about it is try a different verb.
 * @param error - The response being built.
 * @param res - The response to set the header on.
 */
function handleAllowHeader(error: unknown, res: HttpResponse): void {
    if (!(error instanceof MethodNotAllowedError)) {
        return;
    }
    res.setHeader(KnownHeader.ALLOW, error.allowedMethods.join(', '));
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function handleRateLimitHeaders(error: unknown, res: HttpResponse): void {
    if (!(error instanceof TooManyRequestsError)) {
        return;
    }

    // apart, because not every refusal comes from a limiter: a wait can be known without there
    // being a capacity to report
    if (error.rateLimitResult) {
        const { limit, remaining, resetsAtMs } = error.rateLimitResult;
        res.setHeader(KnownHeader.X_RATE_LIMIT_LIMIT, limit.toString());
        res.setHeader(KnownHeader.X_RATE_LIMIT_REMAINING, remaining.toString());
        res.setHeader(KnownHeader.X_RATE_LIMIT_RESET, Math.ceil(NumberUtilities.divide(resetsAtMs, 1000).toNumber()).toString());
    }

    const retryAtMs: number | undefined = error.retryAtMs;
    if (retryAtMs == undefined) {
        return;
    }
    const now: number = Date.now();
    res.setHeader(KnownHeader.RETRY_AFTER,
        Math.ceil(
            NumberUtilities.subtract(retryAtMs, now)
                .dividedBy(1000)
                .toNumber()
        ).toString());
}

/**
 * Writes the one record anybody investigating this response will have.
 *
 * What is logged is the error that was actually thrown, never a wrapper around it. Wrapping replaced
 * the message with the literal string "Global Error" and blanked the stack before handing it over, so
 * every 5xx in the whole application reached the aggregator under one identical message with an empty
 * stack trace - grouping, fingerprinting and alert-on-new-error-type all rest on those two fields.
 * @param error - The value that was thrown, whatever it turned out to be.
 * @param httpError - The response it was translated into, which is what decides the level.
 */
function handleLogging(error: unknown, httpError: HttpError): void {
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);

    // the one case the wrapper is for: a thrown value that is not an Error has no message and no
    // stack of its own, so GlobalError is what gives the record a name and keeps the value as a cause
    if (!ErrorUtilities.isError(error)) {
        logger.critical(new GlobalError(error));
        return;
    }

    // a client error is not a defect and does not belong on a level that says something is broken.
    // The ones that are security relevant - a refused login, an authorization denial, a replayed
    // refresh token - are recorded by the audit trail where they happen, with a reason a detection
    // rule can key on. The rest are an access log's job
    if (httpError.status < HttpStatus.INTERNAL_SERVER_ERROR) {
        // except this one. A rate limit refusal is the one client error that is a security event of
        // its own, and this is where it becomes a refusal to a caller rather than backpressure the
        // application absorbed itself - the mail queue waiting its turn raises the same error and is
        // never seen here. It cannot double up with the audit event of whatever was being attempted:
        // `@RateLimited` sits on the route method, so a limiter that trips means the body that would
        // have audited never ran. The log context carries the url and the client ip with it
        if (error instanceof TooManyRequestsError) {
            logger.audit({ action: AuditAction.RATE_LIMITED, outcome: AuditOutcome.FAILURE });
        }
        return;
    }

    logger.error(error);
}