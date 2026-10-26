import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type';
import { AuthControllerOptions } from './auth-controller-options.model';
import { AuthControllerCsrfTokenRoutes, AuthControllerFederatedRoutes, AuthControllerIdentityRoutes, AuthControllerLinkIdentityConfirmingRoutes, AuthControllerLinkIdentityRoutes, AuthControllerLoginRoutes, AuthControllerPasswordResetRoutes, AuthControllerLoginOptionsRoutes, AuthControllerRegistrationRoutes, AuthControllerTwoFactorRoutes } from './auth-controller-routes.model';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';
import { Newable } from '../../types/newable.type';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';

/**
 * Whether any of the given instance types has the given member.
 */
type AnyHas<Instances, Key extends PropertyKey> = [Extract<Instances, Record<Key, unknown>>] extends [never] ? false : true;

/**
 * The routes of a group when any of the given instance types has the member that marks it, none otherwise.
 */
type RoutesIf<Instances, Key extends PropertyKey, Routes> = AnyHas<Instances, Key> extends true ? Routes : unknown;

/**
 * The routes `AuthController` defines for the given strategies, authenticators and two factor methods.
 */
export type AuthControllerRoutes<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods
> = AuthControllerLoginRoutes
    & RoutesIf<InstanceType<Strategies[number]>, 'resolveCsrfToken', AuthControllerCsrfTokenRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmPasswordReset', AuthControllerPasswordResetRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'resolveLoginOptions', AuthControllerLoginOptionsRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmRegistration', AuthControllerRegistrationRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmProviderLogin', AuthControllerFederatedRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'requestLinkIdentity', AuthControllerLinkIdentityRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'confirmLinkIdentity', AuthControllerLinkIdentityConfirmingRoutes>
    & RoutesIf<InstanceType<Authenticators[number]>, 'findIdentities', AuthControllerIdentityRoutes>
    & ([Methods[number]] extends [never] ? unknown : AuthControllerTwoFactorRoutes);

/**
 * A controller class defined by `AuthController`: the routes its options call for, and the options.
 */
export type AuthControllerClass<
    Strategies extends AuthControllerStrategyClass[] = AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[] = AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods = TwoFactorMethods
> = Newable<AuthControllerRoutes<Strategies, Authenticators, Methods>> & {
    /**
     * What the routes were built from.
     */
    readonly authControllerOptions: AuthControllerOptions<Strategies, Authenticators, Methods>
};