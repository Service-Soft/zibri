import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { BaseUserEntity } from '../../auth/models/base-user.model';
import { BaseRoleRepository } from '../../auth/roles/base-role-repository.model';
import { BaseRoleEntity } from '../../auth/roles/base-role.model';
import { BaseUserRepository } from '../../auth/user/base-user-repository.model';
import { CacheInvalidation } from '../../caching/cache-invalidation.model';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { Entity } from '../../entity/decorators/entity.decorator';

// a file of its own and without the test server's furniture, because a class declared with
// @RepositoryFor is checked by every application the file starts once it is imported

@Entity({ tenant: 'shared' })
class LonelyUser extends BaseUserEntity<string>() {}

@Entity()
class LonelyRole extends BaseRoleEntity {}

// the roles of the users, so that the memberships are all the application lacks
@RepositoryFor(LonelyRole)
class LonelyRoleRepository extends BaseRoleRepository<LonelyRole>() {}

@RepositoryFor(LonelyUser)
class LonelyUserRepository extends BaseUserRepository<LonelyUser>() {}

describe('MembershipService - starting', () => {
    it('refuses to start an application with users and nowhere to read their memberships from', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [createInMemoryDataSource({
                entities: [LonelyUser, LonelyRole, CacheInvalidation],
                repositories: [LonelyUserRepository, LonelyRoleRepository]
            })]
        });

        await expect(start).rejects.toThrow(/No membership repository is listed/);
    }, TestTimeouts.inMemory.start);
});
