import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type.ts';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type.ts';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model.ts';

/**
 * What the routes of `AuthController` are built from. Each has to name exactly what the application
 * registers: its auth strategies that log in, its authenticators, and its two factor methods.
 */
export type AuthControllerOptions<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods
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
    twoFactorMethods: Methods
};