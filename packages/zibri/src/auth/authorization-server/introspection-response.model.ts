import { IntrospectedConfirmation } from './introspected-confirmation.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * Whether a token is active, and what it says when it is (RFC 7662, 2.2).
 */
export class IntrospectionResponse {
    /**
     * Whether the token may be used right now. Nothing else is answered for a token that may not.
     */
    @Property.boolean()
    active!: boolean;

    /**
     * The roles the token may use right now, separated by spaces.
     */
    @Property.string({ required: false })
    scope?: string;

    /**
     * The id of the client the token was issued to: of its api key.
     */
    @Property.string({ required: false })
    client_id?: string;

    /**
     * The email of the user the token acts as.
     */
    @Property.string({ required: false })
    username?: string;

    /**
     * What kind of token it is: `Bearer` for an access token, `refresh_token` for a refresh token.
     */
    @Property.string({ required: false })
    token_type?: string;

    /**
     * When the token expires, in seconds since the epoch.
     */
    @Property.number({ required: false })
    exp?: number;

    /**
     * When the token was issued, in seconds since the epoch.
     */
    @Property.number({ required: false })
    iat?: number;

    /**
     * The id of the user the token acts as.
     */
    @Property.string({ required: false })
    sub?: string;

    /**
     * Who the token is for.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    aud?: string[];

    /**
     * Who issued the token.
     */
    @Property.string({ required: false })
    iss?: string;

    /**
     * The id of the token.
     */
    @Property.string({ required: false })
    jti?: string;

    /**
     * The client certificate the token is bound to, as `{ "x5t#S256": thumbprint }` (RFC 8705).
     */
    @Property.object({ cls: () => IntrospectedConfirmation, required: false })
    cnf?: IntrospectedConfirmation;
}