import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InjectRepository, LoggerInterface, Repository, Transaction, UserRepo, UserRepositoryInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { Roles, User, UserCreateData } from '../models';

@UserRepo()
export class UserRepository extends Repository<User, UserCreateData>
    implements UserRepositoryInterface<Roles, User> {

    constructor(
        @InjectRepository(User)
        repo: Repository<User>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(User, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findByEmail(email: string): Promise<User> {
        return await this.findOne({ where: { email } });
    }

    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { deactivatedAt }, { transaction });
    }
}