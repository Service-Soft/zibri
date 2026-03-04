import { AuthStrategyInterface } from './auth-strategy.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * A generic auth strategy array.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type AuthStrategies = Newable<AuthStrategyInterface<string, BaseUser<string>, any, any, any, any, any, any>>[];