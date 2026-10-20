import { Roles } from './roles.enum.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { BaseMembershipEntity } from '../../../tenancy/membership/base-membership.model.ts';

@Entity({ uniques: [['userId']] })
export class TestMembership extends BaseMembershipEntity(Roles) {}