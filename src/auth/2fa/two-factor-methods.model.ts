import { TwoFactorMethod } from './methods/two-factor-method.interface';
import { Newable } from '../../types/newable.type';

/**
 * A generic two factor method array.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type TwoFactorMethods = Newable<TwoFactorMethod<any, any>>[];