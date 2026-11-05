import { RedirectResponse } from '../../http/redirect-response.model';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { HtmlResponse } from '../../parsing/html/html-response.model';
import { Route } from '../../routing/controller-route-configuration.model';
import { FederatedCallbackForm } from '../authenticators/federated/federated-callback-form.model';
import { LinkedIdentity } from '../authenticators/linked-identity.model';
import { ChangePasswordAtLoginInput } from '../authenticators/password/change-password-at-login-input.model';
import { ChangePasswordDto } from '../authenticators/password/change-password-data.model';
import { ConfirmPasswordResetDto } from '../authenticators/password/confirm-password-reset-data.model';
import { PasswordResetTokenInput } from '../authenticators/password/password-reset-token-input.model';
import { PasswordResetTokenValidity } from '../authenticators/password/password-reset-token-validity.model';
import { RequestPasswordResetInput } from '../authenticators/password/request-password-reset-input.model';
import { type CurrentUser } from '../decorators/current-user.decorator';
import { EmailVerificationTokenInput } from '../email-verification/email-verification-token-input.model';
import { RequestEmailChangeInput } from '../email-verification/request-email-change-input.model';
import { BaseUser } from '../models/base-user.model';
import { LogoutResult } from '../models/logout-result.model';
import { UserLogin } from '../models/user-login.model';
import { CsrfToken } from '../strategies/csrf-token.model';

/**
 * Where the routes of a login at a provider are, below the path of the auth controller.
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
    logout: (strategy: string | undefined, data: object) => Promise<LogoutResult>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    logoutEverywhere: (user: CurrentUser) => Promise<void>
};

/**
 * The routes of `AuthController` for a strategy that lists the logins of a user.
 */
export type AuthControllerLoginListingRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    findLogins: (user: CurrentUser) => Promise<UserLogin[]>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    endLogin: (user: CurrentUser, loginId: string) => Promise<void>
};

/**
 * The routes of `AuthController` that verify and change the email address of a user.
 */
export type AuthControllerEmailVerificationRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestEmailVerification: (user: CurrentUser) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmEmailVerification: (input: EmailVerificationTokenInput) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestEmailChange: (user: CurrentUser, input: RequestEmailChangeInput) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmEmailChange: (input: EmailVerificationTokenInput) => Promise<void>
};

/**
 * The routes of `AuthController` for an authenticator that changes passwords: at the request of a
 * logged in user, and at a login waiting for a new password.
 */
export type AuthControllerPasswordChangeRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    changePassword: (user: CurrentUser, data: ChangePasswordDto) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    changePasswordAtLogin: (strategy: string | undefined, input: ChangePasswordAtLoginInput) => Promise<unknown>
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
 * The route of `AuthController` for an authenticator that hands out a challenge to log in with.
 */
export type AuthControllerLoginOptionsRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    loginOptions: (authenticator: string | undefined) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that registers users by itself.
 */
export type AuthControllerRegistrationRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestRegistration: (authenticator: string | undefined, request: object) => Promise<unknown>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmRegistration: (authenticator: string | undefined, answer: object) => Promise<unknown>
};

/**
 * The routes of `AuthController` for an authenticator that logs users in at a provider.
 */
export type AuthControllerFederatedRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestProviderLogin: (
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
    continueLinkIdentity: (provider: string, code: string) => Promise<RedirectResponse>,
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
 * The route of `AuthController` for an authenticator whose identities a user links to their account.
 */
export type AuthControllerLinkIdentityRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestLinkIdentity: (authenticator: string | undefined, request: object) => Promise<unknown>
};

/**
 * The route of `AuthController` for an authenticator that confirms a link with an answer of the client.
 */
export type AuthControllerLinkIdentityConfirmingRoutes = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmLinkIdentity: (authenticator: string | undefined, answer: object) => Promise<void>
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
    removeTwoFactorRegistration: (user: BaseUser<string>, method: string) => Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestSecondFactor: (user: BaseUser<string>, method: string | undefined) => Promise<unknown>
};