import { Newable } from '../../types/newable.type';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';
import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type';
import { AuthControllerOptions } from './auth-controller-options.model';
import { AuthControllerUpdateCurrentUserRoutes, AuthControllerConfirmEmailRoutes, AuthControllerCsrfTokenRoutes, AuthControllerCurrentUserRoutes, AuthControllerEmailVerificationRoutes, AuthControllerFederatedRoutes, AuthControllerIdentityRoutes, AuthControllerInvitationRoutes, AuthControllerLinkIdentityConfirmingRoutes, AuthControllerLinkIdentityRoutes, AuthControllerLoginListingRoutes, AuthControllerLoginRoutes, AuthControllerPasswordChangeRoutes, AuthControllerPasswordResetRoutes, AuthControllerLoginOptionsRoutes, AuthControllerRegistrationRoutes, AuthControllerTwoFactorRegistrationsRoutes, AuthControllerTwoFactorRoutes, AuthControllerLoginLinkRoutes, AuthControllerLoginMethodsRoutes } from './auth-controller-routes.model';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';

/**
 * Whether any of the given instance types has the given member.
 */
type AnyHas<Instances, Key extends PropertyKey> = [Extract<Instances, Record<Key, unknown>>] extends [never] ? false : true;

/**
 * The routes of a group when any of the given instance types has the member that marks it, none otherwise.
 */
type RoutesIf<Instances, Key extends PropertyKey, Routes> = AnyHas<Instances, Key> extends true ? Routes : unknown;

/**
 * The routes of the email addresses: those of `emailVerification`, and `POST /confirm-email` beside them with
 * `confirmEmailRoute`.
 */
type EmailRoutes<EmailVerification extends boolean, ConfirmEmailRoute extends boolean> = [EmailVerification] extends [true]
    ? AuthControllerEmailVerificationRoutes & ([ConfirmEmailRoute] extends [true] ? AuthControllerConfirmEmailRoutes : unknown)
    : unknown;

/**
 * The routes of the two factor methods, none without one, and `GET /2fa/registrations` beside them with
 * `twoFactorRegistrationsRoute`.
 */
type TwoFactorRoutes<Methods extends TwoFactorMethods, TwoFactorRegistrationsRoute extends boolean> = [Methods[number]] extends [never]
    ? unknown
    : AuthControllerTwoFactorRoutes & ([TwoFactorRegistrationsRoute] extends [true] ? AuthControllerTwoFactorRegistrationsRoutes : unknown);

/**
 * The routes `AuthController` defines for the given strategies, authenticators and two factor methods,
 * whether it verifies email addresses, and which of the routes it has only when asked for it are there.
 */
export type AuthControllerRoutes<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods,
    EmailVerification extends boolean = false,
    CurrentUserRoute extends boolean = false,
    ConfirmEmailRoute extends boolean = false,
    TwoFactorRegistrationsRoute extends boolean = false,
    InvitationRoutes extends boolean = false,
    UpdateCurrentUserRoute extends boolean = false,
    LoginMethodsRoute extends boolean = false
> = AuthControllerLoginRoutes
    & EmailRoutes<EmailVerification, ConfirmEmailRoute>
    & ([CurrentUserRoute] extends [true] ? AuthControllerCurrentUserRoutes : unknown)
    & ([UpdateCurrentUserRoute] extends [true] ? AuthControllerUpdateCurrentUserRoutes : unknown)
    & ([InvitationRoutes] extends [true] ? AuthControllerInvitationRoutes : unknown)
    & ([LoginMethodsRoute] extends [true] ? AuthControllerLoginMethodsRoutes : unknown)
    & RoutesIf<InstanceType<Strategies[number]>, 'resolveCsrfToken', AuthControllerCsrfTokenRoutes>
    & RoutesIf<InstanceType<Strategies[number]>, 'findLogins', AuthControllerLoginListingRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmPasswordReset', AuthControllerPasswordResetRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'changePassword', AuthControllerPasswordChangeRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'requestLoginLink', AuthControllerLoginLinkRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'resolveLoginOptions', AuthControllerLoginOptionsRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmRegistration', AuthControllerRegistrationRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmProviderLogin', AuthControllerFederatedRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'requestLinkIdentity', AuthControllerLinkIdentityRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmLinkIdentity', AuthControllerLinkIdentityConfirmingRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'findIdentities', AuthControllerIdentityRoutes>
    & TwoFactorRoutes<Methods, TwoFactorRegistrationsRoute>;

/**
 * A controller class defined by `AuthController`: the routes its options call for, and the options.
 */
export type AuthControllerClass<
    Strategies extends AuthControllerStrategyClass[] = AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[] = AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods = TwoFactorMethods,
    EmailVerification extends boolean = boolean,
    CurrentUserRoute extends boolean = boolean,
    ConfirmEmailRoute extends boolean = boolean,
    TwoFactorRegistrationsRoute extends boolean = boolean,
    InvitationRoutes extends boolean = boolean,
    UpdateCurrentUserRoute extends boolean = boolean,
    LoginMethodsRoute extends boolean = boolean
> = Newable<AuthControllerRoutes<
    Strategies,
    Authenticators,
    Methods,
    EmailVerification,
    CurrentUserRoute,
    ConfirmEmailRoute,
    TwoFactorRegistrationsRoute,
    InvitationRoutes,
    UpdateCurrentUserRoute,
    LoginMethodsRoute
>> & {
    /**
     * What the routes were built from.
     */
    readonly authControllerOptions: AuthControllerOptions<
        Strategies,
        Authenticators,
        Methods,
        EmailVerification,
        CurrentUserRoute,
        ConfirmEmailRoute,
        TwoFactorRegistrationsRoute,
        InvitationRoutes,
        UpdateCurrentUserRoute,
        LoginMethodsRoute
    >
};
