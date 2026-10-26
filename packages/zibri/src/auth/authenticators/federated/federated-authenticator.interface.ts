import { FederatedCredentials, FederatedTicketCredentials } from './federated-credentials.model';
import { FederatedIdentity } from './federated-identity.model';
import { FederatedLinkIdentityRequest } from './federated-link-identity-request.model';
import { FederatedLinkIdentityStart } from './federated-link-identity-start.model';
import { FederatedMetadata } from './federated-metadata.model';
import { FederatedProviderLogoutMessage } from './federated-provider-logout-message.model';
import { FederatedProviderLogout } from './federated-provider-logout.model';
import { FederatedRegistration } from './federated-registration.model';
import { FederatedRouteEndpoint } from './federated-route-endpoint.model';
import { FederatedRoute } from './federated-route.type';
import { FederatedSessionMatch } from './federated-session-match.model';
import { FederatedSession } from './federated-session.model';
import { FederatedLoginRequest } from './federated-login-request.model';
import { FederatedLoginResult } from './federated-login-result.model';
import { FederatedSoapLogout } from './federated-soap-logout.model';
import { BaseUser } from '../../models/base-user.model';
import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from '../identity-linking-authenticator.interface';

/**
 * Interface for an authenticator that logs users in at a provider: the browser is sent there, and
 * comes back with an answer the provider proves who logged in with.
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
        FederatedLinkIdentityRequest,
        FederatedLinkIdentityStart
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
     * Requests a login at the provider. Answers with the url at the provider to send the browser to.
     */
    requestProviderLogin: (request: FederatedLoginRequest) => Promise<string>,
    /**
     * Sends a link requested with `requestLinkIdentity` on to the provider, by its one-time code.
     * Answers with the url at the provider to send the browser to.
     */
    continueLinkIdentity: (code: string) => Promise<string>,
    /**
     * Takes the provider's answer to a login: the query of a redirect, or the fields of a form post.
     */
    confirmProviderLogin: (answer: URLSearchParams) => Promise<FederatedLoginResult>,
    /**
     * The origins the provider's answer may be posted to the callback from. None when it redirects.
     */
    resolveFormPostOrigins: () => Promise<string[]>,
    /**
     * The document about the application the provider is set up with, or undefined when the protocol has none.
     */
    resolveMetadata: () => Promise<FederatedMetadata | undefined>,
    /**
     * The url at the provider that ends the session a login was started from, or undefined when the
     * provider cannot be told.
     */
    createLogoutUrl: (session: FederatedSession) => Promise<string | undefined>,
    /**
     * Reads what the provider sent the browser to the `logout` route with: the query of a redirect, or
     * the fields of a posted form.
     */
    readProviderLogout: (message: FederatedProviderLogoutMessage) => Promise<FederatedProviderLogout>,
    /**
     * Reads the SOAP envelope the provider sent the `logout/soap` route server to server, exactly as
     * it arrived, and answers which logins end and the envelope to answer with.
     */
    resolveSoapLogout: (envelope: string) => Promise<FederatedSoapLogout>,
    /**
     * Reads the logout token the provider sent the `logout/back-channel` route server to server, and
     * answers which logins end.
     */
    resolveBackChannelLogout: (token: string) => Promise<FederatedSessionMatch>
}

/**
 * Checks whether or not the given value is an authenticator that logs users in at a provider.
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
        'requestProviderLogin',
        'continueLinkIdentity',
        'confirmProviderLogin',
        'resolveFormPostOrigins',
        'resolveMetadata',
        'createLogoutUrl',
        'readProviderLogout',
        'resolveSoapLogout',
        'resolveBackChannelLogout'
    ];
    return keys.every(key => key in value);
}