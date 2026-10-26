import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { Entity } from '../../entity/decorators/entity.decorator';
import { BaseMembershipRepository } from '../../tenancy/membership/base-membership-repository.model';
import { BaseMembershipEntity } from '../../tenancy/membership/base-membership.model';
import { BaseUserEntity } from '../models/base-user.model';
import { BaseUserRepository } from '../user/base-user-repository.model';

// a file of its own and without the test server's furniture, because a class declared with
// @RepositoryFor is checked by every application the file starts once it is imported

@Entity({ tenant: 'shared' })
class PlainUser extends BaseUserEntity<string>() {}

@Entity({ uniques: [['userId']] })
class PlainMembership extends BaseMembershipEntity<string>() {}

@RepositoryFor(PlainUser)
class PlainUserRepository extends BaseUserRepository<PlainUser>() {}

// the memberships of the users, so that the roles are all the application lacks
@RepositoryFor(PlainMembership)
class PlainMembershipRepository extends BaseMembershipRepository<PlainMembership>() {}

describe('RoleService - starting', () => {
    it('refuses to start an application with users and nowhere to read their roles from', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [PlainUser, PlainMembership],
                    repositories: [PlainUserRepository, PlainMembershipRepository]
                })
            ]
        });

        await expect(start).rejects.toThrow(/No role repository is listed/);
    }, TestTimeouts.inMemory.start);
});