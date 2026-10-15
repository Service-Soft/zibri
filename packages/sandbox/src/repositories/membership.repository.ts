import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InjectRepository, LoggerInterface, MembershipRepo, MembershipRepositoryInterface, Repository, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { Membership, Roles } from '../models';

@MembershipRepo()
export class MembershipRepository extends Repository<Membership>
    implements MembershipRepositoryInterface<Roles, Membership> {

    constructor(
        @InjectRepository(Membership)
        repo: Repository<Membership>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(Membership, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findMembership(userId: string): Promise<Membership | undefined> {
        return await this.findOne({ where: { userId }, required: false });
    }

    async findMemberships(userId: string): Promise<Membership[]> {
        return await this.findAll({ where: { userId }, acrossTenants: true });
    }

    async resolveMembership(userId: string, transaction: Transaction | undefined): Promise<Membership> {
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