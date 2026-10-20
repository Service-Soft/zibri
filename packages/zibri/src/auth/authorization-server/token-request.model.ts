import { OAuth2ClientCredentials } from './oauth2-client-credentials.model.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * What a client sends to the token endpoint (RFC 6749, 4.4.2).
 */
export class TokenRequest extends OAuth2ClientCredentials {
    /**
     * How the client asks for a token: `client_credentials`.
     */
    @Property.string({ required: false })
    grant_type?: string;

    /**
     * The roles the token may use, separated by spaces. All the client's api key may use when left out.
     */
    @Property.string({ required: false })
    scope?: string;

    /**
     * The services the token is for (RFC 8707). The application itself when left out.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    resource?: string[];
}