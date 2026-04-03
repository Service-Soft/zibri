import { Inject, inject, InjectRepository, JwtCredentials, LoggerInterface, Repository, repositoryTokenFor, UserRepo, UserRepositoryInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { Roles, User, UserCreateData } from '../models';

@UserRepo()
export class UserRepository extends Repository<User, UserCreateData>
    implements UserRepositoryInterface<Roles, User, JwtCredentials> {

    constructor(
        @InjectRepository(User)
        repo: Repository<User>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(User, repo, logger);
    }

    async findByEmail(email: string): Promise<User> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: User): Promise<JwtCredentials> {
        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));
        return repo.findOne({ where: { userId: user.id } });
    }
}