import { UserRepo } from '../../auth/decorators/user-repo.decorator.ts';
import { UserRepositoryInterface } from '../../auth/user/user-repository.interface.ts';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../data-source/hooks/hooks.default.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';

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