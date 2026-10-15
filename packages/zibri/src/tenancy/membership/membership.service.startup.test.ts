import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { UserRepo } from '../../auth/decorators/user-repo.decorator';
import { BaseUserEntity } from '../../auth/models/base-user.model';
import { UserRepositoryInterface } from '../../auth/user/user-repository.interface';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../data-source/hooks/hooks.default';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { Entity } from '../../entity/decorators/entity.decorator';
import { type LoggerInterface } from '../../logging/logger.interface';

// a file of its own and without the test server's furniture, because a class marked with
// @MembershipRepo is registered for every application the file starts once it is imported

@Entity({ tenant: 'shared' })
class LonelyUser extends BaseUserEntity(Roles) {}

@UserRepo()
class LonelyUserRepository extends Repository<LonelyUser> implements UserRepositoryInterface<Roles, LonelyUser> {
    constructor(
        @InjectRepository(LonelyUser)
        repo: Repository<LonelyUser>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(LonelyUser, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findByEmail(email: string): Promise<LonelyUser> {
        return await this.findOne({ where: { email } });
    }

    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { deactivatedAt }, { transaction });
    }
}

describe('MembershipService - starting', () => {
    it('refuses to start an application with users and nowhere to read their memberships from', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [LonelyUser] })]
        });

        await expect(start).rejects.toThrow(/No class is marked with @MembershipRepo/);
        // the repository is what makes the application one with users
        expect(LonelyUserRepository.name).toBe('LonelyUserRepository');
    }, 30000);
});