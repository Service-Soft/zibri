import { RedirectResponse } from '../../http/redirect-response.model.ts';
import { FileResponse } from '../../parsing/form-data/file-response.model.ts';
import { HtmlResponse } from '../../parsing/html/html-response.model.ts';
import { Route } from '../../routing/controller-route-configuration.model.ts';
import { FederatedCallbackForm } from '../authenticators/federated/federated-callback-form.model.ts';
import { LinkedIdentity } from '../authenticators/linked-identity.model.ts';
import { ConfirmPasswordResetDto } from '../authenticators/password/confirm-password-reset-data.model.ts';
import { PasswordResetTokenInput } from '../authenticators/password/password-reset-token-input.model.ts';
import { PasswordResetTokenValidity } from '../authenticators/password/password-reset-token-validity.model.ts';
import { RequestPasswordResetInput } from '../authenticators/password/request-password-reset-input.model.ts';
import { BaseUser } from '../models/base-user.model.ts';
import { LogoutResult } from '../models/logout-result.model.ts';
import { CsrfToken } from '../strategies/csrf-token.model.ts';

/**
 * Where the routes of a sign-in at a provider are, below the path of the auth controller.
 */
export const FEDERATED_ROUTE: Route = '/federated';

/**
 * The routes of `AuthController` every application gets: logging in, refreshing a login and logging out.
 */
export type AuthControllerLoginRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    login: (authenticator: string | undefined, strategy: string | undefined, credentials: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    refreshLogin: (strategy: string | undefined, data: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    logout: (strategy: string | undefined, data: object) => Promise<LogoutResult>
};

/**
 * The route of `AuthController` for a strategy that issues csrf tokens.
 */
export type AuthControllerCsrfTokenRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    csrfToken: (strategy: string | undefined) => Promise<CsrfToken>
};

/**
 * The routes of `AuthController` for an authenticator that resets passwords.
 */
export type AuthControllerPasswordResetRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    requestPasswordReset: (data: RequestPasswordResetInput) => Promise<void>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    verifyPasswordResetToken: (input: PasswordResetTokenInput) => Promise<PasswordResetTokenValidity>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    confirmPasswordReset: (data: ConfirmPasswordResetDto) => Promise<void>
};

/**
 * The route of `AuthController` for an authenticator that hands out a challenge to sign in with.
 */
export type AuthControllerSignInOptionsRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    signInOptions: (authenticator: string | undefined) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that signs up users by itself.
 */
export type AuthControllerSignUpRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    registrationOptions: (authenticator: string | undefined, request: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    register: (authenticator: string | undefined, answer: object) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that signs users in at a provider.
 */
export type AuthControllerFederatedRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    authorize: (
        authenticator: string | undefined,
        redirectTo: string,
        codeChallenge: string | undefined,
        strategy: string | undefined,
        reauthenticate: boolean | undefined,
        scopes: string | undefined
    ) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    callback: (provider: string) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    formPostCallback: (provider: string, form: FederatedCallbackForm) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    connectProvider: (provider: string, code: string) => Promise<RedirectResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    providerLogout: (provider: string) => Promise<RedirectResponse | HtmlResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    postedProviderLogout: (provider: string, form: FederatedCallbackForm) => Promise<RedirectResponse | HtmlResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    soapProviderLogout: (provider: string, envelope: string) => Promise<FileResponse>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    metadata: (provider: string) => Promise<FileResponse>
};

/**
 * The route of `AuthController` for an authenticator whose identities a user connects to their account.
 */
export type AuthControllerConnectionRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    startConnection: (authenticator: string | undefined, request: object) => Promise<unknown>
};

/**
 * The route of `AuthController` for an authenticator that finishes connecting with an answer of the client.
 */
export type AuthControllerConnectionCompletingRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    completeConnection: (authenticator: string | undefined, answer: object) => Promise<void>
};

/**
 * The routes of `AuthController` for an authenticator that links identities to users.
 */
export type AuthControllerIdentityRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    findIdentities: (user: BaseUser<string>) => Promise<LinkedIdentity[]>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    unlinkIdentity: (user: BaseUser<string>, identityId: string) => Promise<void>
};

/**
 * The routes of `AuthController` for two factor methods.
 */
export type AuthControllerTwoFactorRoutes = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    requestTwoFactorRegistration: (user: BaseUser<string>, method: string | undefined, data: object | undefined) => Promise<unknown>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    confirmTwoFactorRegistration: (user: BaseUser<string>, method: string | undefined, data: object) => Promise<void>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    removeTwoFactorMethod: (user: BaseUser<string>, method: string) => Promise<void>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    startSecondFactor: (user: BaseUser<string>, method: string | undefined) => Promise<unknown>
};