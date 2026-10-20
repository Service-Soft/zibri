import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * What the authorization server publishes about itself (RFC 8414), for clients and resource servers
 * to find its endpoints and keys by its issuer.
 */
export class AuthorizationServerMetadata {
    /**
     * Who issues the tokens: the application's `baseUrl`.
     */
    @Property.string()
    issuer!: string;

    /**
     * Where a client asks for a token.
     */
    @Property.string()
    token_endpoint!: string;

    /**
     * Where a resource server asks whether a token is active.
     */
    @Property.string()
    introspection_endpoint!: string;

    /**
     * Where a token is revoked.
     */
    @Property.string()
    revocation_endpoint!: string;

    /**
     * Where the keys tokens are signed with are published, when they are.
     */
    @Property.string({ required: false })
    jwks_uri?: string;

    /**
     * The response types of an authorization endpoint, of which there is none.
     */
    @Property.array({ items: { type: 'string' } })
    response_types_supported!: string[];

    /**
     * How a client may ask for a token.
     */
    @Property.array({ items: { type: 'string' } })
    grant_types_supported!: string[];

    /**
     * How a client may authenticate at the token endpoint.
     */
    @Property.array({ items: { type: 'string' } })
    token_endpoint_auth_methods_supported!: string[];

    /**
     * What a jwt a client signs to authenticate may be signed with.
     */
    @Property.array({ items: { type: 'string' } })
    token_endpoint_auth_signing_alg_values_supported!: string[];

    /**
     * How a client may authenticate at the introspection endpoint.
     */
    @Property.array({ items: { type: 'string' } })
    introspection_endpoint_auth_methods_supported!: string[];

    /**
     * How a client may authenticate at the revocation endpoint: as at the token endpoint, or not at all.
     */
    @Property.array({ items: { type: 'string' } })
    revocation_endpoint_auth_methods_supported!: string[];

    /**
     * Whether tokens issued over a client certificate are bound to it (RFC 8705).
     */
    @Property.boolean()
    tls_client_certificate_bound_access_tokens!: boolean;

    /**
     * What a DPoP proof may be signed with (RFC 9449).
     */
    @Property.array({ items: { type: 'string' } })
    dpop_signing_alg_values_supported!: string[];
}