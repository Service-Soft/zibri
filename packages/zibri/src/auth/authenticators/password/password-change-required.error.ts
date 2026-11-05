import { CustomBodyHttpError } from '../../../error-handling/errors/custom-body-http.error';
import { HttpStatus } from '../../../http/http-status.enum';
import { JsonMimeType } from '../../../http/json-mime-type.type';
import { MimeType } from '../../../http/mime-type.enum';
import { $ts } from '../../../localization/translate.function';
import { TracingUtilities } from '../../../tracing/tracing.utilities';

/**
 * What a login answers when its credentials and any second factor were accepted, and the user chooses
 * a new password before it starts.
 *
 * Answers `401` with the body every other error has, plus the `ticket` the new password is set with.
 */
export class PasswordChangeRequiredError extends CustomBodyHttpError {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly body: unknown;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON];

    constructor(
        /**
         * The ticket the new password is set with.
         */
        readonly ticket: string,
        options?: ErrorOptions
    ) {
        super($ts`Choose a new password to finish logging in.`, HttpStatus.UNAUTHORIZED, $ts`New password required`, options);
        this.name = 'PasswordChangeRequiredError';
        this.body = {
            status: this.status,
            name: this.name,
            message: this.message,
            paragraphs: this.paragraphs,
            traceId: TracingUtilities.getCurrentTraceContext()?.traceId,
            ticket
        };
    }
}