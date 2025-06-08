import { Newable } from '../../types';
import { AuthStrategyInterface } from '../auth-strategy.interface';
import { BaseUser } from './base-user.model';

// eslint-disable-next-line typescript/no-explicit-any
export type AuthStrategies = Newable<AuthStrategyInterface<string, BaseUser<string>, any, any>>[];