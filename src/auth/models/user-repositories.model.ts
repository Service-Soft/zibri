import { Newable } from '../../types';
import { UserRepositoryInterface } from '../user-repository.interface';
import { BaseUser } from './base-user.model';

// eslint-disable-next-line typescript/no-explicit-any
export type UserRepositories = Newable<UserRepositoryInterface<string, BaseUser<string>, any>>[];