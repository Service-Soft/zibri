import { BaseUser } from './base-user.model';
import { Newable } from '../../types';
import { UserRepositoryInterface } from '../user/user-repository.interface';

/**
 * A generic user repository array.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type UserRepositories = Newable<UserRepositoryInterface<string, BaseUser<string>, any>>[];