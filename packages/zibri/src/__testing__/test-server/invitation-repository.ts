import { BaseInvitationRepository } from '../../auth/invitation/base-invitation-repository.model';
import { BaseUser } from '../../auth/models/base-user.model';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { TestInvitation } from '../mocks/entities/test-invitation.entity';

/**
 * The invitation repository of the test fixtures, which creates the account of an invitation as a user of the
 * fixtures with the role every user starts with.
 */
@RepositoryFor(TestInvitation)
export class TestServerInvitationRepository extends BaseInvitationRepository<TestInvitation>() {
    /**
     * The names of the invitations an account was created for, in the order they were, for the suites to read.
     */
    static readonly createdFor: string[] = [];

    override async createInvitedUser(
        invitation: TestInvitation,
        transaction: RepositoryTransaction | undefined
    ): Promise<BaseUser<string>> {
        TestServerInvitationRepository.createdFor.push(invitation.name);
        return await inject(repositoryTokenFor(JwtUser)).create({ email: invitation.email, roles: [Roles.USER] }, { transaction });
    }
}