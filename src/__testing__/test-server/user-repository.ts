import { UserRepo } from '../../auth/decorators/user-repo.decorator';
import { JwtCredentials } from '../../auth/strategies/jwt/jwt-credentials.model';
import { UserRepositoryInterface } from '../../auth/user/user-repository.interface';
import { Repository } from '../../data-source/repository';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';

@UserRepo()
export class DefaultTestServerUserRepository extends Repository<JwtUser>
    implements UserRepositoryInterface<Roles, JwtUser, JwtCredentials> {

    constructor(
        @InjectRepository(JwtUser)
        repo: Repository<JwtUser>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(JwtUser, repo, logger);
    }

    async findByEmail(email: string): Promise<JwtUser> {
        return await this.findOne({ where: { email } });
    }

    async resolveCredentialsFor(user: JwtUser): Promise<JwtCredentials> {
        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));
        return repo.findOne({ where: { userId: user.id } });
    }
}