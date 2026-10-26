import { BaseUserRepository } from '../../auth/user/base-user-repository.model';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { JwtUser } from '../mocks/entities/jwt-user.entity';

@RepositoryFor(JwtUser)
export class DefaultTestServerUserRepository extends BaseUserRepository<JwtUser>() {}