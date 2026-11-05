import type { FakeOidcIdTokenClaims } from './fake-oauth-provider.model';

/**
 * What a fake provider signs an access token for an api with.
 */
export type FakeJwtAccessTokenOptions = {
    /**
     * The `aud` claim: the api the token is for.
     */
    audience: string,
    /**
     * The `typ` of the header.
     * @default 'at+jwt'
     */
    type?: string,
    /**
     * Claims put in on top of the ones every token carries, or in their place, such as a `cnf`.
     * @default {}
     */
    claims?: FakeOidcIdTokenClaims
};