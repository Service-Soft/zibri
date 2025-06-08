import { inject, InjectRepository, JwtCredentials, Repository, repositoryTokenFor, UserRepo, UserRepositoryInterface } from 'zibri';

import { Roles, User, UserCreateData } from '../models';

@UserRepo()
export class UserRepository extends Repository<User, UserCreateData>
    implements UserRepositoryInterface<Roles, User, JwtCredentials> {

    constructor(
        @InjectRepository(User)
        repo: Repository<User>
    ) {
        super(User, repo);
    }

    async findByEmail(email: string): Promise<User> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: User): Promise<JwtCredentials> {
        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));
        return repo.findOne({ where: { userId: user.id } });
    }
}