import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { ExternalError } from '../external-error.model';

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