import { NextFunction } from 'express';

import { ErrorPageTemplate, GlobalErrorHandler } from './error-handler.model';
import { ErrorUtilities } from './error.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { HttpError } from './errors/http.error';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { LoggerInterface } from '../logging/logger.interface';
import { PreactUtilities } from '../preact/preact.utilities';
import { GlobalError } from './errors/global.error';
import { TooManyRequestsError } from './errors/too-many-requests.error';
import { NumberUtilities } from '../utilities/number.utilities';

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

    const globalError: GlobalError = new GlobalError(error);
    globalError.stack = undefined;
    await handleLogging(error, globalError);

    const httpError: HttpError = ErrorUtilities.toHttpError(error);
    handleRateLimitHeaders(httpError, res);

    const preferred: string | false = req.accepts(MimeType.JSON, MimeType.HTML);

    if (preferred !== 'html' && preferred !== 'text/html') {
        res.status(httpError.status).json({
            status: httpError.status,
            name: httpError.name,
            message: httpError.message,
            paragraphs: httpError.paragraphs
        });
        return;
    }

    const template: ErrorPageTemplate | undefined = inject(ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE);
    if (!template) {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await logger.warn('Could not find a template for the error page.');
        await logger.warn(
            'Either provide ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE or your own error handler (ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER).'
        );
        await logger.warn('Falling back to returning a json response');
        res.status(httpError.status).json({
            status: httpError.status,
            name: httpError.name,
            message: httpError.message,
            paragraphs: httpError.paragraphs
        });
        return;
    }

    try {
        const html: string = await PreactUtilities.renderPage(template, { error: httpError });
        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        res.status(httpError.status).send(html);
    }
    catch {
        res.status(httpError.status).json({
            status: httpError.status,
            name: httpError.name,
            message: httpError.message,
            paragraphs: httpError.paragraphs
        });
    }
};

// eslint-disable-next-line jsdoc/require-jsdoc
function handleRateLimitHeaders(error: unknown, res: HttpResponse): void {
    if (!(error instanceof TooManyRequestsError) || !error.rateLimitResult) {
        return;
    }

    const { limit, remaining, resetsAtMs, retryAtMs } = error.rateLimitResult;
    const now: number = Date.now();

    res.setHeader(KnownHeader.X_RATE_LIMIT_LIMIT, limit.toString());
    res.setHeader(KnownHeader.X_RATE_LIMIT_REMAINING, remaining.toString());
    res.setHeader(KnownHeader.X_RATE_LIMIT_RESET, Math.ceil(NumberUtilities.divide(resetsAtMs, 1000).toNumber()).toString());
    res.setHeader(KnownHeader.RETRY_AFTER,
        Math.ceil(
            NumberUtilities.subtract(retryAtMs, now)
                .dividedBy(1000)
                .toNumber()
        ).toString());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function handleLogging(error: unknown, globalError: Error): Promise<void> {
    if (!ErrorUtilities.isError(error)) {
        await inject(ZIBRI_DI_TOKENS.LOGGER).critical(globalError);
        return;
    }
    if (!ErrorUtilities.isExternalError(error)) {
        await inject(ZIBRI_DI_TOKENS.LOGGER).error(globalError);
    }
}