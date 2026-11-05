import { BaseUserRepository, RepositoryFor } from 'zibri';

import { User, UserCreateData } from '../models';

@RepositoryFor(User)
export class UserRepository extends BaseUserRepository<User, UserCreateData>() {}