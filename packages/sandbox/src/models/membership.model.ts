import { BaseMembershipEntity, Entity } from 'zibri';

import { Roles } from './roles.enum';

// one membership per user in each tenant
@Entity({ uniques: [['userId']] })
export class Membership extends BaseMembershipEntity(Roles) {}