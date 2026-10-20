import { Newable } from '../../types/newable.type.ts';
import { AuthControllerAuthenticatorInterface } from '../authenticators/auth-controller-authenticator.interface.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * A class of an authenticator the routes of `AuthController` log in with.
 */
// any, because the credentials type is a parameter of `authenticate`, as on Authenticators
// eslint-disable-next-line typescript/no-explicit-any
export type AuthControllerAuthenticatorClass = Newable<AuthControllerAuthenticatorInterface<string, BaseUser<string>, any>>;