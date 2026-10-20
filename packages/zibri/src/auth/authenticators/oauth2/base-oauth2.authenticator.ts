import type { ClientAuth, Configuration, CustomFetch, DiscoveryRequestOptions, TokenEndpointResponse, TokenEndpointResponseHelpers } from 'openid-client';

import { ErrorUtilities } from '../../../error-handling/error.utilities.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { FederatedProviderIdentity } from '../federated/federated-provider-identity.model.ts';
import { FederatedSignInFailure } from '../federated/federated-sign-in-failure.enum.ts';
import { FederatedSignInError } from '../federated/federated-sign-in.error.ts';
import { BaseOAuthAuthenticator } from '../oauth/base-oauth.authenticator.ts';
import { OAuthCodeExchange } from '../oauth/oauth-code-exchange.model.ts';
import { OAuthProviderSignIn } from '../oauth/oauth-provider-sign-in.model.ts';
import { OpenIdClient } from '../oauth/open-id-client.type.ts';

/**
 * Authenticates a user by a sign-in at a provider that speaks plain OAuth2, without OpenID Connect,
 * such as GitHub.
 *
 * Such a provider issues no ID token, so who signed in is read from its api with the access token of
 * the sign-in. Extend it once for every provider, naming the provider, its endpoints and the client
 * registered there, and reading the user in `resolveIdentity`. The sign-in itself runs through the
 * routes of `AuthController`.
 *
 * A sign-in through such a provider never counts as a recent login: the provider does not say when
 * the user signed in there.
 */
export abstract class BaseOAuth2Authenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOAuthAuthenticator<RoleType, UserType> {
    /**
     * Where the browser is sent to sign in at the provider.
     */
    abstract readonly authorizationEndpoint: string;

    /**
     * Where the code the provider answers with is exchanged for an access token.
     */
    abstract readonly tokenEndpoint: string;

    /**
     * Where tokens are handed back once they are no longer kept, as RFC 7009 has it. None by default,
     * and then they are only removed here.
     */
    readonly revocationEndpoint: string | undefined = undefined;

    /**
     * Reads who signed in from the provider's api, with the access token of the sign-in.
     * @param accessToken - The access token.
     * @returns Who signed in, as the provider names them, and what it reports about them.
     */
    protected abstract resolveIdentity(accessToken: string): Promise<Pick<FederatedProviderIdentity, 'subject' | 'profile'>>;

    /**
     * Reads json from the provider's api, with the access token of the sign-in.
     *
     * Goes through the application's http client, as every other request to the provider does.
     * @param url - Where to read from.
     * @param accessToken - The access token.
     * @param headers - Headers the provider's api asks for on top.
     * @returns The json, unchecked.
     * @throws When the api does not answer with success.
     */
    protected async fetchJson(url: string, accessToken: string, headers: Record<string, string> = {}): Promise<unknown> {
        const client: OpenIdClient = this.resolveOpenIdClient();
        const response: Response = await client.fetchProtectedResource(
            await this.resolveConfiguration(),
            accessToken,
            new URL(url),
            'GET',
            undefined,
            new Headers({ [KnownHeader.ACCEPT]: MimeType.JSON, ...headers })
        );
        if (!response.ok) {
            throw new Error(`The provider answered ${String(response.status)} to GET ${url}.`);
        }
        return JsonUtilities.parse<unknown>(await response.text());
    }

    protected override createConfiguration(
        client: OpenIdClient,
        clientAuthentication: ClientAuth,
        requestOptions: DiscoveryRequestOptions
    ): Configuration {
        // configured rather than discovered: a provider without OpenID Connect publishes nothing to
        // discover. The request options apply here as they would to a discovered configuration
        const configuration: Configuration = new client.Configuration(
            {
                issuer: this.issuer,
                authorization_endpoint: this.authorizationEndpoint,
                token_endpoint: this.tokenEndpoint,
                revocation_endpoint: this.revocationEndpoint
            },
            this.clientId,
            undefined,
            clientAuthentication
        );
        const customFetch: CustomFetch | undefined = requestOptions[client.customFetch];
        if (customFetch != undefined) {
            configuration[client.customFetch] = customFetch;
        }
        for (const apply of requestOptions.execute ?? []) {
            apply(configuration);
        }
        return configuration;
    }

    /**
     * Exchanges the code for an access token, and reads who signed in from the provider's api with it.
     * @param answer - Everything the provider sent the browser back with.
     * @param exchange - What the answer is checked and exchanged with.
     * @returns Who signed in, and the tokens.
     * @throws FederatedSignInError when the provider cannot be reached, or does not say who signed in.
     */
    protected override async resolveSignIn(answer: URLSearchParams, exchange: OAuthCodeExchange): Promise<OAuthProviderSignIn> {
        const tokens: TokenEndpointResponse & TokenEndpointResponseHelpers = await this.exchangeCode(answer, exchange, {
            idTokenExpected: false
        });
        let identity: Pick<FederatedProviderIdentity, 'subject' | 'profile'>;
        try {
            identity = await this.resolveIdentity(tokens.access_token);
        }
        catch (error) {
            // a refusal stays a refusal; anything else is the provider's api not answering as it should
            if (ErrorUtilities.isRefusal(error)) {
                throw error;
            }
            throw new FederatedSignInError(FederatedSignInFailure.PROVIDER_ERROR, { cause: error, action: exchange.action });
        }
        return {
            identity: {
                issuer: this.issuer,
                subject: identity.subject,
                // the provider does not say when the user signed in there, and may have reused its own
                // session without asking them. So the sign-in never counts as a recent login, rather than
                // passing a provider session as a fresh login to a route that would take one for a second
                // factor
                authenticatedAt: new Date(0),
                profile: identity.profile
            },
            tokens
        };
    }
}