import { $ts } from '../localization/translate.function';
import { JsonUtilities } from '../utilities/json.utilities';
import { HttpError } from './errors/http.error';
import { InternalServerError } from './errors/internal-server.error';
import { ExternalError } from './external-error.model';

/**
 * Utilities for handling errors.
 */
export abstract class ErrorUtilities {

    /**
     * Converts the given value to an http error.
     * @param value - The value to transform.
     * @returns Value if it was a http error, a new internal server error otherwise.
     */
    static toHttpError(value: unknown): HttpError {
        if (this.isHttpError(value)) {
            return value;
        }
        return new InternalServerError($ts`Internal Server Error`);
    }

    /**
     * Checks if the given value is a http error.
     * @param value - The value to check.
     * @returns True if the value is an instanceof HttpError, false otherwise.
     */
    static isHttpError(value: unknown): value is HttpError {
        return value instanceof HttpError;
    }

    /**
     * Checks if the given value is an external error.
     * @param value - The value to check.
     * @returns True if the value is an instanceof ExternalError, false otherwise.
     */
    static isExternalError(value: unknown): value is ExternalError {
        return value instanceof ExternalError;
    }

    /**
     * Checks if the given value is a error.
     * @param value - The value to check.
     * @returns True if the value is an instanceof Error, false otherwise.
     */
    static isError(value: unknown): value is Error {
        return value instanceof Error;
    }

    /**
     * Converts the given value to an error string.
     * @param error - The caught error value.
     * @returns Error.message if it was a error, stringified error otherwise.
     */
    static unknownToErrorString(error: unknown): string {
        if (this.isError(error)) {
            return error.message;
        }
        return JsonUtilities.stringify(error);
    }
}