import { RedirectResponse } from '../../http/redirect-response.model';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { HtmlResponse } from '../../parsing/html/html-response.model';
import { Route } from '../../routing/controller-route-configuration.model';
import { FederatedCallbackForm } from '../authenticators/federated/federated-callback-form.model';
import { LinkedIdentity } from '../authenticators/linked-identity.model';
import { ConfirmPasswordResetDto } from '../authenticators/password/confirm-password-reset-data.model';
import { PasswordResetTokenInput } from '../authenticators/password/password-reset-token-input.model';
import { PasswordResetTokenValidity } from '../authenticators/password/password-reset-token-validity.model';
import { RequestPasswordResetInput } from '../authenticators/password/request-password-reset-input.model';
import { BaseUser } from '../models/base-user.model';
import { LogoutResult } from '../models/logout-result.model';
import { CsrfToken } from '../strategies/csrf-token.model';

/**
 * Where the routes of a sign-in at a provider are, below the path of the auth controller.
 */
export const FEDERATED_ROUTE: Route = '/federated';

/**
 * The routes of `AuthController` every application gets: logging in, refreshing a login and logging out.
 */
export type AuthControllerLoginRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    login: (authenticator: string | undefined, strategy: string | undefined, credentials: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    refreshLogin: (strategy: string | undefined, data: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    logout: (strategy: string | undefined, data: object) => Promise<LogoutResult>
};

/**
 * The route of `AuthController` for a strategy that issues csrf tokens.
 */
export type AuthControllerCsrfTokenRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    csrfToken: (strategy: string | undefined) => Promise<CsrfToken>
};

/**
 * The routes of `AuthController` for an authenticator that resets passwords.
 */
export type AuthControllerPasswordResetRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestPasswordReset: (data: RequestPasswordResetInput) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    verifyPasswordResetToken: (input: PasswordResetTokenInput) => Promise<PasswordResetTokenValidity>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmPasswordReset: (data: ConfirmPasswordResetDto) => Promise<void>
};

/**
 * The route of `AuthController` for an authenticator that hands out a challenge to sign in with.
 */
export type AuthControllerSignInOptionsRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    signInOptions: (authenticator: string | undefined) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that signs up users by itself.
 */
export type AuthControllerSignUpRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    registrationOptions: (authenticator: string | undefined, request: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    register: (authenticator: string | undefined, answer: object) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that signs users in at a provider.
 */
export type AuthControllerFederatedRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    authorize: (
        authenticator: string | undefined,
        redirectTo: string,
        codeChallenge: string | undefined,
        strategy: string | undefined,
        reauthenticate: boolean | undefined,
        scopes: string | undefined
    ) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    callback: (provider: string) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    formPostCallback: (provider: string, form: FederatedCallbackForm) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    connectProvider: (provider: string, code: string) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    providerLogout: (provider: string) => Promise<RedirectResponse | HtmlResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    postedProviderLogout: (provider: string, form: FederatedCallbackForm) => Promise<RedirectResponse | HtmlResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    soapProviderLogout: (provider: string, envelope: string) => Promise<FileResponse>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    metadata: (provider: string) => Promise<FileResponse>
};

/**
 * The route of `AuthController` for an authenticator whose identities a user connects to their account.
 */
export type AuthControllerConnectionRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    startConnection: (authenticator: string | undefined, request: object) => Promise<unknown>
};

/**
 * The route of `AuthController` for an authenticator that finishes connecting with an answer of the client.
 */
export type AuthControllerConnectionCompletingRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    completeConnection: (authenticator: string | undefined, answer: object) => Promise<void>
};

/**
 * The routes of `AuthController` for an authenticator that links identities to users.
 */
export type AuthControllerIdentityRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    findIdentities: (user: BaseUser<string>) => Promise<LinkedIdentity[]>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    unlinkIdentity: (user: BaseUser<string>, identityId: string) => Promise<void>
};

/**
 * The routes of `AuthController` for two factor methods.
 */
export type AuthControllerTwoFactorRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestTwoFactorRegistration: (user: BaseUser<string>, method: string | undefined, data: object | undefined) => Promise<unknown>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmTwoFactorRegistration: (user: BaseUser<string>, method: string | undefined, data: object) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    removeTwoFactorMethod: (user: BaseUser<string>, method: string) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    startSecondFactor: (user: BaseUser<string>, method: string | undefined) => Promise<unknown>
};