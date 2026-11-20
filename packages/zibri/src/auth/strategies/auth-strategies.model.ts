import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';
import { AuthStrategyInterface } from './auth-strategy.interface';

/**
 * A generic auth strategy array.
 */
export type AuthStrategies = Newable<AuthStrategyInterface<string, BaseUser<string>>>[];