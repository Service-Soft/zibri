import { readFile } from 'fs';
import path from 'path';

import { NextFunction } from 'express';
import Handlebars from 'handlebars';

import { GlobalErrorHandler } from './error-handler.model';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { LoggerInterface } from '../logging';
import { HttpError, InternalServerError, isHttpError } from './errors';
import { isError } from './is-error.function';
import { AssetServiceInterface } from '../assets';
import { GlobalRegistry } from '../global';
import { HttpRequest, HttpResponse, MimeType } from '../http';

export const errorHandler: GlobalErrorHandler = (error: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => {
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    if (isError(error)) {
        if (!isHttpError(error) || error.status >= 500) {
            logger.error(error);
        }
    }
    else {
        logger.error(`There was an unknown error:\n${JSON.stringify(error, undefined, 2)}`);
    }
    if (res.headersSent) {
        next(error);
        return;
    }

    const httpError: HttpError = toHttpError(error);

    const preferred: string | false = req.accepts(MimeType.JSON, MimeType.HTML);

    if (preferred !== 'html') {
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
    readFile(path.join(assetService.assetsPath, 'template', 'error.hbs'), 'utf8', (err, source) => {
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
        const template: HandlebarsTemplateDelegate = Handlebars.compile(source);
        const html: string = template({ error: httpError, name: GlobalRegistry.getAppData('name') });

        res.setHeader('Content-Type', 'text/html');
        res.status(httpError.status).send(html);
    });
};

function toHttpError(value: unknown): HttpError {
    if (isHttpError(value)) {
        return value;
    }
    return new InternalServerError('Internal Server Error');
}