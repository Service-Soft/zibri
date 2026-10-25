import { Entity } from '../../../entity/decorators/entity.decorator';
import { BaseMembershipEntity } from '../../../tenancy/membership/base-membership.model';

/**
 * The membership of the test fixtures. Its roles are the names of rows, such as those of
 * `MemberRoles`.
 */
@Entity({ uniques: [['userId']] })
export class TestMembership extends BaseMembershipEntity<string>() {}