import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../data-source/hooks/hooks.default';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { type LoggerInterface } from '../../logging/logger.interface';
import { MembershipRepo } from '../../tenancy/membership/membership-repo.decorator';
import { MembershipRepositoryInterface } from '../../tenancy/membership/membership-repository.interface';
import { Roles } from '../mocks/entities/roles.enum';
import { TestMembership } from '../mocks/entities/test-membership.entity';

@MembershipRepo()
export class DefaultTestServerMembershipRepository extends Repository<TestMembership>
    implements MembershipRepositoryInterface<Roles, TestMembership> {

    constructor(
        @InjectRepository(TestMembership)
        repo: Repository<TestMembership>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(TestMembership, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findMembership(userId: string): Promise<TestMembership | undefined> {
        return await this.findOne({ where: { userId }, required: false });
    }

    async findMemberships(userId: string): Promise<TestMembership[]> {
        return await this.findAll({ where: { userId }, acrossTenants: true });
    }

    async resolveMembership(userId: string, transaction: Transaction | undefined): Promise<TestMembership> {
        return await this.findOne({ where: { userId }, transaction, required: false })
            ?? await this.create({ userId, roles: [] }, { transaction });
    }

    async updateDeactivatedAt(userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateAll({ userId }, { deactivatedAt }, { transaction });
    }

    async deleteMembership(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.deleteAll({ userId }, { transaction });
    }

    async deleteMemberships(userIds: string[], transaction: Transaction): Promise<void> {
        await this.deleteAll({ userId: { oneOf: userIds } }, { transaction, acrossTenants: true });
    }
}