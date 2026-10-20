import { HttpError } from './http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { JsonMimeType } from '../../http/json-mime-type.type.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';

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