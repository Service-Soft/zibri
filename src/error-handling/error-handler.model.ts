import { NextFunction } from 'express';

import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { PreactComponent } from '../preact/preact-component.model';
import { HttpError } from './errors/http.error';

/**
 * Properties of an error page component.
 */
type ErrorPageTemplateProps = {
    /**
     * The http error that was thrown.
     */
    error: HttpError
};

/**
 * Definition for an error page template.
 */
export type ErrorPageTemplate = PreactComponent<ErrorPageTemplateProps>;

/**
 * A global error handler function.
 */
export type GlobalErrorHandler = (err: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => void | Promise<void>;