import { AuthenticatorInterface } from './authenticator.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * A list of authenticator classes.
 */
// any, because the credentials type is a parameter of `authenticate`: authenticators taking different
// credentials only share a list type through it, as auth strategies do for the same reason
// eslint-disable-next-line typescript/no-explicit-any
export type Authenticators = Newable<AuthenticatorInterface<string, BaseUser<string>, any>>[];