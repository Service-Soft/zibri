import { isJwtConfirmation, JwtConfirmation } from './jwt-confirmation.model';

/**
 * The payload of an access token a client was issued by the authorization server, with the claims
 * RFC 9068 gives such a token.
 */
export type JwtClientAccessTokenPayload = {
    /**
     * The id of the user the client's api key acts as.
     */
    sub: string,
    /**
     * The email of that user.
     */
    email: string,
    /**
     * The roles the token may use, separated by spaces. A request made with it holds those of them
     * the user still has.
     */
    scope: string,
    /**
     * The id of the client's api key.
     */
    client_id: string,
    /**
     * The id of the token, by which it is revoked.
     */
    jti: string,
    /**
     * The tenant the client's api key is bound to. Absent for a key acting in every tenant its user is
     * a member of.
     */
    tenant_id?: string,
    /**
     * The client certificate the token is bound to, when it was issued over one, and the DPoP key,
     * when the client asked for it with a proof.
     */
    cnf?: JwtConfirmation
};

/**
 * Whether a verified token's payload is the payload of an access token a client was issued.
 * @param payload - The verified payload.
 * @returns Whether it can be read as such.
 */
export function isJwtClientAccessTokenPayload(payload: unknown): payload is JwtClientAccessTokenPayload {
    if (typeof payload !== 'object' || payload == undefined) {
        return false;
    }
    return 'sub' in payload && typeof payload.sub === 'string'
        && 'email' in payload && typeof payload.email === 'string'
        && 'scope' in payload && typeof payload.scope === 'string'
        && 'client_id' in payload && typeof payload.client_id === 'string'
        && 'jti' in payload && typeof payload.jti === 'string'
        && (!('tenant_id' in payload) || typeof payload.tenant_id === 'string')
        && (!('cnf' in payload) || isJwtConfirmation(payload.cnf));
}