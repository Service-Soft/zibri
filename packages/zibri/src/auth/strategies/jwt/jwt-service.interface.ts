import { JwtKey } from './jwt-key.model';
import { JwtSignOptions } from './jwt-sign-options.model';
import { JwtVerifyOptions } from './jwt-verify-options.model';
import { VerifiedJwt } from './verified-jwt.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Interface for the service signing and verifying the access tokens of the application.
 *
 * Holds the access token keys of `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS`. Every strategy issuing or reading
 * access tokens goes through it, so they are signed with one key and name one issuer.
 */
export interface JwtServiceInterface {
    /**
     * Who the application says it is on the jwts it signs, and requires on those it takes: its
     * `baseUrl`, without a trailing slash. Throws an InternalError while the application has none.
     */
    readonly issuer: string,
    /**
     * How long an access token is valid.
     */
    readonly accessTokenExpiresInMs: number,
    /**
     * Signs an access token with the current key: `typ` `at+jwt`, the issuer, the audience, and
     * expiring after `accessTokenExpiresInMs`.
     */
    signAccessToken: (payload: Record<string, unknown>, audience: string | string[]) => Promise<string>,
    /**
     * Finds what an access token the application signed says, when it verifies against one of the
     * keys, names the issuer, and is for the audience, or for anyone when that is undefined.
     */
    findAccessToken: (token: string, audience: string | undefined) => Promise<VerifiedJwt | undefined>,
    /**
     * Signs a jwt of another kind with the current access token key, such as a nonce. Its `typ` is what
     * tells it apart from an access token.
     */
    sign: (payload: Record<string, unknown>, options: OmitStrict<JwtSignOptions, 'issuer'>) => Promise<string>,
    /**
     * Finds what a jwt `sign` signed says, when it verifies, names the issuer and has the `typ` and
     * audience of the options.
     */
    verify: (token: string, options: OmitStrict<JwtVerifyOptions, 'issuer'>) => Promise<VerifiedJwt | undefined>,
    /**
     * Gets the keys access tokens verify against: the current one first, then every previous one.
     */
    getVerificationKeys: () => JwtKey[]
}