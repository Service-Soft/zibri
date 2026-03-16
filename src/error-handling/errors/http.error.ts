import { HttpStatus } from '../../http/http-status.enum';

/**
 * A base http error.
 */
export abstract class HttpError extends Error {
    /**
     * The status of the error.
     */
    status: HttpStatus;
    /**
     * The title of the error.
     */
    title: string;
    /**
     * A paragraphs error with the error message.
     */
    paragraphs: string[];

    constructor(message: string | string[], status: HttpStatus, title: string, options?: ErrorOptions) {
        const singleString: string = typeof message === 'string' ? message : message.join('\n');
        super(singleString, options);
        this.name = 'HttpError';
        this.status = status;
        this.paragraphs = typeof message === 'string' ? [message] : message;
        this.title = title;
    }
}

/**
 * Check whether or not the given value is a http error.
 * @param value - The value to check.
 * @returns True when values name is 'HttpError', false otherwise.
 */
export function isHttpError(value: unknown): value is HttpError {
    return typeof value === 'object' && value != undefined && 'name' in value && value.name === 'HttpError';
}