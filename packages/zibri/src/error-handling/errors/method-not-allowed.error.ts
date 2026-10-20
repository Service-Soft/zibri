import { HttpError } from './http.error.ts';
import { HttpMethod } from '../../http/http-method.enum.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * A http error to throw when the path exists but not under the method it was asked for.
 *
 * The distinction a 404 cannot make: one of these is worth retrying with a different verb and the
 * other never is, and a caller that cannot tell them apart has no way to know which it is looking at.
 */
export class MethodNotAllowedError extends HttpError {
    constructor(method: string, readonly allowedMethods: HttpMethod[], options?: ErrorOptions) {
        super(
            $ts`"${method}" is not allowed here. This route answers ${allowedMethods.join(', ')}.`,
            HttpStatus.METHOD_NOT_ALLOWED,
            $ts`Method Not Allowed`,
            options
        );
        this.name = 'MethodNotAllowedError';
    }
}