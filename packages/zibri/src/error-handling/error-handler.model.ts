import { NextFunction } from 'express';

import { type HttpRequest } from '../http/http-request.model';
import { type HttpResponse } from '../http/http-response.model';
import { TsxComponent } from '../tsx/tsx-component.model';
import { HttpError } from './errors/http.error';

/**
 * Properties of an error page component.
 */
export type ErrorPageTemplateProps = {
    /**
     * The http error that was thrown.
     */
    error: HttpError
};

/**
 * Definition for an error page template.
 */
export type ErrorPageTemplate = TsxComponent<ErrorPageTemplateProps>;

/**
 * A global error handler function.
 */
export type GlobalErrorHandler = (err: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => void | Promise<void>;