import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * The parameters a client authenticates with in the body of a request to the authorization server:
 * its id and secret (RFC 6749, 2.3.1), a jwt it signed (RFC 7523), or its id beside a client
 * certificate (RFC 8705).
 */
export class OAuth2ClientCredentials {
    /**
     * The id of the client: of its api key.
     */
    @Property.string({ required: false })
    client_id?: string;

    /**
     * The secret of the client: its api key.
     */
    @Property.string({ required: false })
    client_secret?: string;

    /**
     * The kind of the jwt the client signed, `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`.
     */
    @Property.string({ required: false })
    client_assertion_type?: string;

    /**
     * The jwt the client signed.
     */
    @Property.string({ required: false })
    client_assertion?: string;
}