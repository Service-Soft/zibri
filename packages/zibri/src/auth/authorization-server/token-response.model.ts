import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * What the token endpoint answers a client with (RFC 6749, 5.1).
 */
export class TokenResponse {
    /**
     * The access token.
     */
    @Property.string()
    access_token!: string;

    /**
     * How the token is sent: `Bearer`.
     */
    @Property.string()
    token_type!: string;

    /**
     * How long the token is valid, in seconds.
     */
    @Property.number({ format: 'integer' })
    expires_in!: number;

    /**
     * The roles the token may use, separated by spaces.
     */
    @Property.string()
    scope!: string;
}