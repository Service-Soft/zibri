import { BaseMembershipEntity, Entity } from 'zibri';

// one membership per user in each tenant, holding the names of roles
@Entity({ uniques: [['userId']] })
export class Membership extends BaseMembershipEntity() {}