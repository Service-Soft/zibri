import { ScimErrorType } from './scim-error-type.enum.ts';
import { ScimSchema } from './scim-schema.enum.ts';
import { CustomBodyHttpError } from '../../error-handling/errors/custom-body-http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { JsonMimeType } from '../../http/json-mime-type.type.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error answered the way SCIM says errors look (RFC 7644, 3.12).
 */
export class ScimError extends CustomBodyHttpError {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly body: unknown;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON_SCIM, MimeType.JSON];

    constructor(status: HttpStatus, detail: TranslatedString, scimType?: ScimErrorType) {
        super(detail, status, $ts`SCIM error`, undefined);
        this.name = 'ScimError';
        // the status as a string, which is what the schema says it is
        this.body = { schemas: [ScimSchema.ERROR], status: `${status}`, ...scimType == undefined ? {} : { scimType }, detail };
    }
}