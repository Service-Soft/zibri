import { BaseUser } from './base-user.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { UserRepositoryInterface } from '../user/user-repository.interface.ts';

/**
 * A generic user repository array.
 */
export type UserRepositories = Newable<UserRepositoryInterface<string, BaseUser<string>>>[];