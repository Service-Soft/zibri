import { TwoFactorMethod } from './methods/two-factor-method.interface.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * A generic two factor method array.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type TwoFactorMethods = Newable<TwoFactorMethod<any, any, any, any>>[];