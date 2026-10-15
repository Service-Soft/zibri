import { FakeOAuthIdentity } from './fake-oauth-identity.model';

/**
 * What a fake provider is started with.
 */
export type FakeOAuthProviderOptions = {
    /**
     * The id of the one client the provider knows.
     */
    clientId: string,
    /**
     * The secret of that client, sent as http basic authentication or in the request body. Or a check of
     * the secret the client sends, for one that is signed rather than fixed, like Apple's.
     */
    clientSecret: string | ((secret: string) => boolean | Promise<boolean>),
    /**
     * What the provider signs its ID tokens with.
     * @default 'ES256'
     */
    algorithm?: 'ES256' | 'RS256' | 'EdDSA',
    /**
     * Whether the provider answers a sign-in with a page that posts the code to the callback, the way a
     * provider using `response_mode=form_post` does, instead of sending the browser back with it in the
     * query.
     * @default false
     */
    formPost?: boolean,
    /**
     * Whether the provider issues an ID token with the access token, as an OpenID Connect provider
     * does. One that issues none speaks plain OAuth2, and says who signed in through its `resources`.
     * @default true
     */
    issuesIdToken?: boolean,
    /**
     * What the provider's api answers, by path, to a request carrying an access token it issued: the
     * json the function makes of whoever that token was issued for.
     * @default {}
     */
    resources?: Record<string, (identity: FakeOAuthIdentity) => unknown>,
    /**
     * The `prompt` values the provider takes. A sign-in asking for another one is answered with an error
     * page, the way Google answers `prompt=login`. Every value, when undefined.
     * @default undefined
     */
    supportedPrompts?: string[],
    /**
     * How long an access token the provider issues is valid, in seconds.
     * @default 300
     */
    accessTokenExpiresInSeconds?: number,
    /**
     * Whether a refresh gives out a new refresh token and refuses the old one from then on.
     * @default false
     */
    rotatesRefreshTokens?: boolean
};