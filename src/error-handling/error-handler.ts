import { NextFunction } from 'express';

import { ErrorPageTemplate, GlobalErrorHandler } from './error-handler.model';
import { isError } from './is-error.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { HttpError, isHttpError } from './errors/http.error';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { LoggerInterface } from '../logging/logger.interface';
import { PreactUtilities } from '../preact/preact.utilities';
import { InternalServerError } from './errors/internal-server.error';

/**
 * The default error handler implementation of Zibri.
 * @param error - The error that was caught.
 * @param req - The http request.
 * @param res - The http response.
 * @param next - The express next function.
 */
export const errorHandler: GlobalErrorHandler = async (error: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => {
    const globalError: Error = new Error('Global Error', { cause: error });
    globalError.stack = undefined;
    await handleLogging(error, globalError);
    if (res.headersSent) {
        next(error);
        return;
    }

    const httpError: HttpError = toHttpError(error);

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
        const html: string = await PreactUtilities.render(template, { error: httpError });
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
async function handleLogging(error: unknown, globalError: Error): Promise<void> {
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);

    if (!isError(error)) {
        await logger.critical(globalError);
        return;
    }
    if (!isHttpError(error) || error.status >= 500) {
        await logger.error(globalError);
    }
}

/**
 * Converts the given value to an http error.
 * @param value - The value to transform.
 * @returns Value if it was a http error, a new internal server error otherwise.
 */
export function toHttpError(value: unknown): HttpError {
    if (isHttpError(value)) {
        return value;
    }
    return new InternalServerError('Internal Server Error');
}