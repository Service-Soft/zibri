import { CustomBodyHttpError } from '../../error-handling/errors/custom-body-http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonMimeType } from '../../http/json-mime-type.type';
import { MimeType } from '../../http/mime-type.enum';
import { $ts } from '../../localization/translate.function';
import { TracingUtilities } from '../../tracing/tracing.utilities';

/**
 * What a login answers when its credentials were accepted and a second factor is still to come.
 *
 * Answers `401` with the body every other error has, plus the `ticket` the login continues with and
 * the names of the `methods` the user has enrolled. An empty list means the user enrolls their first
 * with the ticket.
 */
export class SecondFactorRequiredError extends CustomBodyHttpError {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly body: unknown;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON];

    constructor(
        /**
         * The ticket the login continues with.
         */
        readonly ticket: string,
        /**
         * The names of the two factor methods the user has enrolled.
         */
        readonly methods: string[],
        options?: ErrorOptions
    ) {
        super($ts`Present a second factor to finish logging in.`, HttpStatus.UNAUTHORIZED, $ts`Second factor required`, options);
        this.name = 'SecondFactorRequiredError';
        this.body = {
            status: this.status,
            name: this.name,
            message: this.message,
            paragraphs: this.paragraphs,
            traceId: TracingUtilities.getCurrentTraceContext()?.traceId,
            ticket,
            methods
        };
    }
}