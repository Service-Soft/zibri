import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonMimeType } from '../../http/json-mime-type.type';
import { KnownHeader } from '../../http/known-header.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';

/**
 * An http error that is answered with a body of its own, written as json, in place of the body every
 * other error is answered with. For a protocol that says what its errors look like, such as SCIM.
 */
export abstract class CustomBodyHttpError extends HttpError {
    /**
     * What the response holds.
     */
    abstract readonly body: unknown;

    /**
     * The json types the body can be written as, in the order they are preferred. The request's
     * `Accept` header picks one, and the first is taken when it accepts several or names none.
     */
    abstract readonly mimeTypes: JsonMimeType[];

    /**
     * The headers the response carries besides the body and its type, by name.
     */
    readonly headers: Partial<Record<Exclude<KnownHeader, KnownHeader.CONTENT_TYPE | KnownHeader.CONTENT_LENGTH>, string>> = {};

    constructor(
        message: TranslatedString | TranslatedString[],
        status: HttpStatus,
        title: TranslatedString,
        options: ErrorOptions | undefined
    ) {
        super(message, status, title, options);
        this.name = 'CustomBodyHttpError';
    }
}