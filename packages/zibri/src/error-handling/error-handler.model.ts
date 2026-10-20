import { NextFunction } from 'express';

import { HttpRequest } from '../http/http-request.model.ts';
import { HttpResponse } from '../http/http-response.model.ts';
import { TsxComponent } from '../tsx/tsx-component.model.ts';
import { HttpError } from './errors/http.error.ts';

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
export type ErrorPageTemplate = TsxComponent<ErrorPageTemplateProps>;

/**
 * A global error handler function.
 */
export type GlobalErrorHandler = (err: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => void | Promise<void>;