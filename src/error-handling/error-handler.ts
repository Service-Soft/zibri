import { readFile } from 'fs';
import path from 'path';

import { NextFunction } from 'express';
import handlebars from 'handlebars';

import { GlobalErrorHandler } from './error-handler.model';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { LoggerInterface } from '../logging';
import { HttpError, InternalServerError, isHttpError } from './errors';
import { isError } from './is-error.function';
import { AssetServiceInterface } from '../assets';
import { GlobalRegistry } from '../global';
import { HttpRequest, HttpResponse, KnownHeader, MimeType } from '../http';

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

    const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    readFile(path.join(assetService.pageTemplatePath, 'error.hbs'), 'utf8', (err, source) => {
        if (err) {
            res.status(httpError.status).json({
                status: httpError.status,
                name: httpError.name,
                message: httpError.message,
                paragraphs: httpError.paragraphs
            });
            return;
        }

        // compile the template
        const template: HandlebarsTemplateDelegate = handlebars.compile(source);
        const html: string = template({ error: httpError, name: GlobalRegistry.getAppData('name') });

        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        res.status(httpError.status).send(html);
    });
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