import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { BaseRoleRepository } from './base-role-repository.model';
import { BaseRoleEntity } from './base-role.model';
import { TestTimeouts } from '../../__testing__/constants';
import { CacheInvalidation } from '../../caching/cache-invalidation.model';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BaseMembershipRepository } from '../../tenancy/membership/base-membership-repository.model';
import { BaseMembershipEntity } from '../../tenancy/membership/base-membership.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BaseUserEntity } from '../models/base-user.model';
import { BaseUserRepository } from '../user/base-user-repository.model';

// a file of its own, because a class declared with @RepositoryFor is checked by every application
// the file starts once it is imported, and this one's role entity is unlike the fixtures'

@Entity({ tenant: 'shared' })
class CodedUser extends BaseUserEntity<string>() {}

@Entity({ uniques: [['userId']] })
class CodedMembership extends BaseMembershipEntity<string>() {}

/**
 * A role identified by a code besides its name, which an upsert can meet it by.
 */
@Entity()
class CodedRole extends BaseRoleEntity {
    @Property.string({ unique: true })
    code!: string;
}

@RepositoryFor(CodedUser)
class CodedUserRepository extends BaseUserRepository<CodedUser>() {}

@RepositoryFor(CodedMembership)
class CodedMembershipRepository extends BaseMembershipRepository<CodedMembership>() {}

@RepositoryFor(CodedRole)
class CodedRoleRepository extends BaseRoleRepository<CodedRole>() {}

describe('RoleWriteObserver', () => {
    let server: StartedTestServer | undefined;
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [CodedUser, CodedMembership, CodedRole, CacheInvalidation],
        repositories: [CodedUserRepository, CodedMembershipRepository, CodedRoleRepository]
    });

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('refuses an upsert renaming a role somebody holds through what it sets on a conflict', async () => {
        const roles: CodedRoleRepository = inject(CodedRoleRepository);
        await roles.create({ name: 'holder', code: 'h', level: 'platform', permissions: [] });
        await inject(CodedUserRepository).create({ email: 'holder@coded-roles.test', roles: ['holder'] });

        await expect(roles.upsert(
            { code: 'h' },
            { name: 'holder', code: 'h', level: 'platform', permissions: [] },
            { name: { set: 'renamed' } }
        )).rejects.toThrow(/'holder'[\S\s]*still held/);
        // the listed repositories are what make it an application with users and memberships
        expect(inject(CodedMembershipRepository)).toBeInstanceOf(CodedMembershipRepository);
    });

    it('lets a user and a membership hold roles created earlier in the same transaction', async () => {
        const transaction: Transaction = await inject(dataSourceClass).startTransaction();
        try {
            await inject(CodedRoleRepository).createAll([
                { name: 'seeded-admin', code: 'sa', level: 'platform', permissions: [] },
                { name: 'seeded-member', code: 'sm', level: 'tenant', permissions: [] }
            ], { transaction });
            const user: CodedUser = await inject(CodedUserRepository).create(
                { email: 'seeded@coded-roles.test', roles: ['seeded-admin'] },
                { transaction }
            );
            await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(UUIDUtilities.generate(), async () => {
                await inject(CodedMembershipRepository).create({ userId: user.id, roles: ['seeded-member'] }, { transaction });
            });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }

        expect((await inject(CodedUserRepository).findByEmail('seeded@coded-roles.test')).roles).toEqual(['seeded-admin']);
    });

    it('still refuses a role a rolled back transaction created', async () => {
        const transaction: Transaction = inject(dataSourceClass).startTransaction();
        await inject(CodedRoleRepository).create({ name: 'rolled-back', code: 'rb', level: 'platform', permissions: [] }, { transaction });
        await inject(CodedUserRepository).create({ email: 'rolled-back@coded-roles.test', roles: ['rolled-back'] }, { transaction });
        await transaction.rollback();

        await expect(inject(CodedUserRepository).create({ email: 'after-rollback@coded-roles.test', roles: ['rolled-back'] }))
            .rejects.toThrow(/The role 'rolled-back' does not exist/);
    });
});