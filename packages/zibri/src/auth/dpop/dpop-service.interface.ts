import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AuthorizationToken } from '../strategies/authorization-token.model';
import { JwtAsymmetricAlgorithm } from '../strategies/jwt/jwt-asymmetric-algorithm.type';

/**
 * Interface for the service checking the DPoP proofs of requests (RFC 9449).
 *
 * A client proves with every request that it holds the private key a token is bound to: the request
 * carries a proof in its `DPoP` header, a jwt the client signs with that key for the request's method
 * and url. A token bound to the key works only with such a proof.
 */
export interface DpopServiceInterface {
    /**
     * What a proof may be signed with.
     */
    readonly algorithms: JwtAsymmetricAlgorithm[],
    /**
     * Resolves the RFC 7638 thumbprint of the key the DPoP proof of a request is signed with, once the
     * proof is checked: one `DPoP` header, holding a jwt of `typ` `dpop+jwt` signed with the public key
     * its header carries, for the method and url of the request, issued within the last minutes, never
     * presented before, carrying a nonce the application issued while `ZIBRI_DI_TOKENS.DPOP_NONCES` is
     * true, and the hash of the access token when one is given. Answered for one request once, however
     * often it is asked.
     *
     * Undefined for a request that carries no proof, and for a websocket message. Throws an OAuth2Error
     * `invalid_dpop_proof`, or `use_dpop_nonce` with a new nonce. An error about a request sending an
     * access token is answered `401`, challenging the caller with the `DPoP` scheme.
     */
    resolveProofThumbprint: (
        context: HttpRequestContext | WebsocketRequestContext,
        accessToken: string | undefined
    ) => Promise<string | undefined>,
    /**
     * Resolves whether a request sends an access token the way its binding says: a token bound to a
     * DPoP key with the `DPoP` scheme and a proof signed with that key, any other with the `Bearer`
     * scheme. Throws like `resolveProofThumbprint` for a proof that is not valid.
     */
    isSentAsBound: (
        context: HttpRequestContext | WebsocketRequestContext,
        token: AuthorizationToken,
        keyThumbprint: string | undefined
    ) => Promise<boolean>
}