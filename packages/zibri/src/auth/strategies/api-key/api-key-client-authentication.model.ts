import { JsonWebKey } from 'node:crypto';

import { ApiKeyAuthenticationMethod } from './api-key-authentication-method.enum';

/**
 * How an api key without a secret proves itself at the token endpoint of the authorization server.
 */
export type ApiKeyClientAuthentication = {
    /**
     * By a jwt signed with the private key belonging to this public key.
     */
    method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT,
    /**
     * The public key, PEM encoded or as a JSON Web Key.
     */
    publicKey: string | JsonWebKey
} | {
    /**
     * By a jwt signed with one of the keys the client publishes at this url.
     */
    method: ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT,
    /**
     * The https url of the client's JSON Web Key Set.
     */
    jwksUrl: string
} | {
    /**
     * By a client certificate an authority of the client certificate strategy issued, which that
     * strategy finds the key's user for.
     */
    method: ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH
} | {
    /**
     * By this client certificate, which may be self-signed.
     */
    method: ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH,
    /**
     * The certificate, PEM encoded.
     */
    certificate: string
};