import { HttpStatus } from '../../http/http-status.enum';

/**
 * What an OAuth2 error is answered with besides its code and description.
 */
export type OAuth2ErrorOptions = {
    /**
     * The status to answer with in place of the one the code has: `401` for an error about a token a
     * resource was sent.
     */
    status?: HttpStatus,
    /**
     * The `WWW-Authenticate` header, which challenges the caller to authenticate with a scheme.
     */
    challenge?: string,
    /**
     * A nonce the DPoP proofs of the caller carry from now on, answered in the `DPoP-Nonce` header.
     */
    dpopNonce?: string
};