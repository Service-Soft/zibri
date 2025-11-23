import { TwoFactorMethod } from './methods';
import { Newable } from '../../types';

/**
 * A generic two factor method array.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type TwoFactorMethods = Newable<TwoFactorMethod<any, any>>[];