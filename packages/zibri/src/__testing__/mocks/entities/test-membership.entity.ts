import { Roles } from './roles.enum';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { BaseMembershipEntity } from '../../../tenancy/membership/base-membership.model';

@Entity({ uniques: [['userId']] })
export class TestMembership extends BaseMembershipEntity(Roles) {}