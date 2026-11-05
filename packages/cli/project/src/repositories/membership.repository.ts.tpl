import { BaseMembershipRepository, RepositoryFor } from 'zibri';

import { Membership } from '../models';

@RepositoryFor(Membership)
export class MembershipRepository extends BaseMembershipRepository<Membership>() {}
