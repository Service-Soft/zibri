import { UserRepo } from '../../auth/decorators/user-repo.decorator';
import { UserRepositoryInterface } from '../../auth/user/user-repository.interface';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../data-source/hooks/hooks.default';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { type LoggerInterface } from '../../logging/logger.interface';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';

@UserRepo()
export class DefaultTestServerUserRepository extends Repository<JwtUser>
    implements UserRepositoryInterface<Roles, JwtUser> {

    constructor(
        @InjectRepository(JwtUser)
        repo: Repository<JwtUser>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(JwtUser, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findByEmail(email: string): Promise<JwtUser> {
        return await this.findOne({ where: { email } });
    }

    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { deactivatedAt }, { transaction });
    }
}