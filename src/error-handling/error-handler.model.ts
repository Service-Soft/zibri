import { NextFunction } from 'express';

import { HttpRequest, HttpResponse } from '../http';
import { PreactComponent } from '../preact';
import { HttpError } from './errors';

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