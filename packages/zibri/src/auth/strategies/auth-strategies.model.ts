import { AuthStrategyInterface } from './auth-strategy.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * A generic auth strategy array.
 */
export type AuthStrategies = Newable<AuthStrategyInterface<string, BaseUser<string>>>[];