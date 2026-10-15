import { FederatedConnectionRequest } from './federated-connection-request.model';
import { FederatedConnectionStart } from './federated-connection-start.model';
import { FederatedCredentials, FederatedTicketCredentials } from './federated-credentials.model';
import { FederatedIdentity } from './federated-identity.model';
import { FederatedMetadata } from './federated-metadata.model';
import { FederatedProviderLogout } from './federated-provider-logout.model';
import { FederatedRegistration } from './federated-registration.model';
import { FederatedRouteEndpoint } from './federated-route-endpoint.model';
import { FederatedRoute } from './federated-route.type';
import { FederatedSession } from './federated-session.model';
import { FederatedSignInRequest } from './federated-sign-in-request.model';
import { FederatedSignInResult } from './federated-sign-in-result.model';
import { BaseUser } from '../../models/base-user.model';
import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from '../identity-linking-authenticator.interface';

/**
 * Interface for an authenticator that signs users in at a provider: the browser is sent there, and
 * comes back with an answer the provider proves who signed in with.
 *
 * The routes of `AuthController` find it by its `name`. `BaseFederatedAuthenticator` implements it.
 */
export interface FederatedAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>
> extends IdentityLinkingAuthenticatorInterface<
        RoleType,
        UserType,
        FederatedCredentials,
        FederatedTicketCredentials,
        FederatedRegistration,
        FederatedIdentity,
        FederatedConnectionRequest,
        FederatedConnectionStart
    > {
    /**
     * The routes whose urls the authenticator gives out, with the method the browser requests each
     * with. The application refuses to start while one of their urls reaches no route of it that
     * answers that method.
     */
    readonly routes: FederatedRouteEndpoint[],
    /**
     * The url of one of the `routes`, below the application's `baseUrl`.
     */
    resolveRouteUrl: (route: FederatedRoute) => string,
    /**
     * Starts a sign-in at the provider. Answers with the url at the provider to send the browser to.
     */
    startSignIn: (request: FederatedSignInRequest) => Promise<string>,
    /**
     * Sends a connection started with `startConnection` on to the provider, by its one-time code.
     * Answers with the url at the provider to send the browser to.
     */
    continueConnection: (code: string) => Promise<string>,
    /**
     * Takes the provider's answer to a sign-in: the query of a redirect, or the fields of a form post.
     */
    completeSignIn: (answer: URLSearchParams) => Promise<FederatedSignInResult>,
    /**
     * The origins the provider's answer may be posted to the callback from. None when it redirects.
     */
    resolveFormPostOrigins: () => Promise<string[]>,
    /**
     * The document about the application the provider is set up with, or undefined when the protocol has none.
     */
    resolveMetadata: () => FederatedMetadata | undefined,
    /**
     * The url at the provider that ends the session a login was started from, or undefined when the
     * provider cannot be told.
     */
    createLogoutUrl: (session: FederatedSession) => Promise<string | undefined>,
    /**
     * Reads what the provider sent the browser to the `logout` route with: its query as it was read,
     * and exactly as it was sent.
     */
    readProviderLogout: (query: URLSearchParams, rawQuery: string) => Promise<FederatedProviderLogout>
}

/**
 * Checks whether or not the given value is an authenticator that signs users in at a provider.
 * @param value - The value to check.
 * @returns True if it links identities to users and has every key FederatedAuthenticatorInterface adds.
 */
export function isFederatedAuthenticator(value: unknown): value is FederatedAuthenticatorInterface<string, BaseUser<string>> {
    if (!isIdentityLinkingAuthenticator(value)) {
        return false;
    }
    const keys: string[] = [
        'routes',
        'resolveRouteUrl',
        'startSignIn',
        'continueConnection',
        'completeSignIn',
        'resolveFormPostOrigins',
        'resolveMetadata',
        'createLogoutUrl',
        'readProviderLogout'
    ];
    return keys.every(key => key in value);
}