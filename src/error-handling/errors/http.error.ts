import { HttpStatus } from '../../http';

export abstract class HttpError extends Error {
    status: HttpStatus;
    title: string;
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

export function isHttpError(value: unknown): value is HttpError {
    return value instanceof HttpError;
}