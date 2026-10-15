import { BaseUser } from './base-user.model';
import { Newable } from '../../types/newable.type';
import { UserRepositoryInterface } from '../user/user-repository.interface';

/**
 * A generic user repository array.
 */
export type UserRepositories = Newable<UserRepositoryInterface<string, BaseUser<string>>>[];