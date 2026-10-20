import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';
import { AuthControllerStrategyInterface } from '../strategies/auth-controller-strategy.interface.ts';

/**
 * A class of an auth strategy the routes of `AuthController` log in with.
 */
// any, because the auth data, the refresh and the logout data are parameters: strategies taking
// different ones only share a list type through it, as on Authenticators
// eslint-disable-next-line typescript/no-explicit-any
export type AuthControllerStrategyClass = Newable<AuthControllerStrategyInterface<string, BaseUser<string>, any, any, any>>;