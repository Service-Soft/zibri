import { RepositoryClass } from 'zibri';

import { MembershipRepository, RoleRepository, UserRepository } from '../../repositories';

/**
 * The repository classes of this application's entities.
 *
 * Declared here rather than on the data source for the reason the entities are, so that a test's
 * data source of the same entities reads them through the same classes.
 */
export const repositories: RepositoryClass[] = [
    UserRepository,
    MembershipRepository,
    RoleRepository
];