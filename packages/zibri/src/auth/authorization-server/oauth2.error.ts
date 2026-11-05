import { OAuth2ErrorCode } from './oauth2-error-code.enum';
import { OAuth2ErrorOptions } from './oauth2-error-options.model';
import { CustomBodyHttpError } from '../../error-handling/errors/custom-body-http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonMimeType } from '../../http/json-mime-type.type';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error answered the way OAuth2 says errors look (RFC 6749, 5.2).
 */
export class OAuth2Error extends CustomBodyHttpError {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly body: unknown;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON];

    override readonly headers: CustomBodyHttpError['headers'];

    constructor(error: OAuth2ErrorCode, description: TranslatedString, options: OAuth2ErrorOptions = {}) {
        super(description, options.status ?? OAuth2Error.toStatus(error), $ts`OAuth2 error`, undefined);
        this.name = 'OAuth2Error';
        this.body = { error, error_description: description };
        this.headers = {
            // an answer about credentials, which no cache in between may keep
            [KnownHeader.CACHE_CONTROL]: 'no-store',
            ...options.challenge == undefined ? {} : { [KnownHeader.WWW_AUTHENTICATE]: options.challenge },
            ...options.dpopNonce == undefined ? {} : { [KnownHeader.DPOP_NONCE]: options.dpopNonce }
        };
    }

    /**
     * The status an error is answered with, unless the options name another.
     * @param error - What went wrong.
     * @returns 401 for a client that could not be authenticated, 403 for a caller without a role, 400
     * for anything else.
     */
    private static toStatus(error: OAuth2ErrorCode): HttpStatus {
        switch (error) {
            case OAuth2ErrorCode.INVALID_CLIENT: {
                return HttpStatus.UNAUTHORIZED;
            }
            case OAuth2ErrorCode.INSUFFICIENT_SCOPE: {
                return HttpStatus.FORBIDDEN;
            }
            case OAuth2ErrorCode.INVALID_REQUEST:
            case OAuth2ErrorCode.UNAUTHORIZED_CLIENT:
            case OAuth2ErrorCode.UNSUPPORTED_GRANT_TYPE:
            case OAuth2ErrorCode.INVALID_SCOPE:
            case OAuth2ErrorCode.INVALID_TARGET:
            case OAuth2ErrorCode.UNSUPPORTED_TOKEN_TYPE:
            case OAuth2ErrorCode.INVALID_DPOP_PROOF:
            case OAuth2ErrorCode.USE_DPOP_NONCE: {
                return HttpStatus.BAD_REQUEST;
            }
        }
    }
}