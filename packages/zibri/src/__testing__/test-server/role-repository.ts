import { BaseRoleRepository } from '../../auth/roles/base-role-repository.model';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { TestRole } from '../mocks/entities/test-role.entity';

@RepositoryFor(TestRole)
export class DefaultTestServerRoleRepository extends BaseRoleRepository<TestRole>() {}