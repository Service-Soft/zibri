import { Newable } from '../../types/newable.type';
import { AuthControllerAuthenticatorInterface } from '../authenticators/auth-controller-authenticator.interface';
import { BaseUser } from '../models/base-user.model';

/**
 * A class of an authenticator the routes of `AuthController` log in with.
 */
// any, because the credentials type is a parameter of `authenticate`, as on Authenticators
// eslint-disable-next-line typescript/no-explicit-any
export type AuthControllerAuthenticatorClass = Newable<AuthControllerAuthenticatorInterface<string, BaseUser<string>, any>>;