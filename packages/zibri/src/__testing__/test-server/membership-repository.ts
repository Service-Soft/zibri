import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../data-source/hooks/hooks.default.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { MembershipRepo } from '../../tenancy/membership/membership-repo.decorator.ts';
import { MembershipRepositoryInterface } from '../../tenancy/membership/membership-repository.interface.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { TestMembership } from '../mocks/entities/test-membership.entity.ts';

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