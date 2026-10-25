import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { BaseMembershipRepository } from '../../tenancy/membership/base-membership-repository.model';
import { TestMembership } from '../mocks/entities/test-membership.entity';

@RepositoryFor(TestMembership)
export class DefaultTestServerMembershipRepository extends BaseMembershipRepository<TestMembership>() {}
