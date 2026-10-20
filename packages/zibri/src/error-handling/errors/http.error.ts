import { HttpStatus } from '../../http/http-status.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { ExternalError } from '../external-error.model.ts';

/**
 * A base http error.
 */
export abstract class HttpError extends ExternalError {
    /**
     * The status of the error.
     */
    status: HttpStatus;

    constructor(
        message: TranslatedString | TranslatedString[],
        status: HttpStatus,
        title: TranslatedString,
        options: ErrorOptions | undefined
    ) {
        super(message, title, options);
        this.name = 'HttpError';
        this.status = status;
    }
}