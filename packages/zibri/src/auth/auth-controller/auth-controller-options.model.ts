import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';

/**
 * What the routes of `AuthController` are built from. Each has to name exactly what the application
 * registers: its auth strategies that log in, its authenticators, and its two factor methods.
 */
export type AuthControllerOptions<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods,
    EmailVerification extends boolean = false,
    CurrentUserRoute extends boolean = false,
    ConfirmEmailRoute extends boolean = false,
    TwoFactorRegistrationsRoute extends boolean = false
> = {
    /**
     * The auth strategies a login can be started with. A request names the one it logs in with by its
     * `name` when there is more than one.
     */
    strategies: Strategies,
    /**
     * The authenticators a login can be proven with. A request names the one it proves its login with
     * by its `name` when more than one could.
     */
    authenticators: Authenticators,
    /**
     * The two factor methods a user can enrol, remove and start. None for no 2fa routes.
     */
    twoFactorMethods: Methods,
    /**
     * Whether the routes verifying and changing the email address of a user are there, which
     * `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS` turns on. Not by default.
     */
    emailVerification?: EmailVerification,
    /**
     * Whether `GET /me` is there, which answers the logged in user and what they may do. Not by default.
     */
    // TODO 4.0: there by default. Off in 3.x, where an application can have a GET /me of its own beside it
    currentUserRoute?: CurrentUserRoute,
    /**
     * Whether `POST /confirm-email` is there, beside the routes of `emailVerification`, which confirms the token of
     * a link verifying an address or confirming a change, for the one page every link can go to. Needs
     * `confirmEmail` of the `EmailVerificationService`. Not by default.
     */
    // TODO 4.0: there by default with emailVerification. Off in 3.x, where an application can have a route of its
    // own at that path
    confirmEmailRoute?: ConfirmEmailRoute,
    /**
     * Whether `GET /2fa/registrations` is there, beside the routes of the two factor methods, which lists the
     * methods the logged in user enrolled. Not by default.
     */
    // TODO 4.0: there by default with twoFactorMethods. Off in 3.x, where an application can have a route of its
    // own at that path
    twoFactorRegistrationsRoute?: TwoFactorRegistrationsRoute
};