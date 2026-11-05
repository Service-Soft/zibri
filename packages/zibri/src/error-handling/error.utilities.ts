import { HttpStatus } from '../http/http-status.enum';
import { $ts } from '../localization/translate.function';
import { JsonUtilities } from '../utilities/json.utilities';
import { GlobalError } from './errors/global.error';
import { HttpError } from './errors/http.error';
import { InternalServerError } from './errors/internal-server.error';
import { ExternalError } from './external-error.model';
import { LoggerInterface } from '../logging/logger.interface';

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
        return this.isHttpError(value) ? value : new InternalServerError($ts`Internal Server Error`);
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
     * Checks if the given value is a refusal: an answer that says no.
     *
     * An http error below 500 is an answer - not found, not allowed, not valid. Anything else means
     * the question could not be answered at all.
     * @param value - The value to check.
     * @returns True if the value is a http error with a status below 500, false otherwise.
     */
    static isRefusal(value: unknown): value is HttpError {
        return this.isHttpError(value) && value.status < HttpStatus.INTERNAL_SERVER_ERROR;
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
     * Logs what a handler threw, the way every handler of the framework does: a value that is not an
     * error as a critical `GlobalError`, since it has no message and no stack of its own, and a server
     * error as it is, never wrapped. A client error is not logged, since it is not a defect; the
     * security relevant ones are in the audit trail where they happen.
     * @param error - What was thrown.
     * @param logger - The logger to write to.
     * @returns True when the error was logged, which is when it is a defect.
     */
    static reportToLog(error: unknown, logger: LoggerInterface): boolean {
        if (!this.isError(error)) {
            logger.critical(new GlobalError(error));
            return true;
        }
        if (this.isHttpError(error) && error.status < HttpStatus.INTERNAL_SERVER_ERROR) {
            return false;
        }
        logger.error(error);
        return true;
    }

    /**
     * Converts the given value to an error string.
     * @param error - The caught error value.
     * @returns Error.message if it was a error, stringified error otherwise.
     */
    static unknownToErrorString(error: unknown): string {
        return this.isError(error) ? error.message : JsonUtilities.stringify(error);
    }
}