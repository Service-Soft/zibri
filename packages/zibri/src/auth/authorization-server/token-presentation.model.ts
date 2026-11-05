import { OAuth2ClientCredentials } from './oauth2-client-credentials.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * What a caller sends to have a token introspected (RFC 7662) or revoked (RFC 7009).
 */
export class TokenPresentation extends OAuth2ClientCredentials {
    /**
     * The token.
     */
    @Property.string({ required: false })
    token?: string;

    /**
     * What kind of token it is, `access_token` or `refresh_token`. Every kind is looked for whatever
     * it says.
     */
    @Property.string({ required: false })
    token_type_hint?: string;
}