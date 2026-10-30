import { BaseRoleRepository, RepositoryFor } from 'zibri';

import { Role } from '../models';

@RepositoryFor(Role)
export class RoleRepository extends BaseRoleRepository<Role>() {}
