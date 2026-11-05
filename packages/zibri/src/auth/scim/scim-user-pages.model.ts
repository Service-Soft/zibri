import { ScimBody } from './scim-body.model';
import { ScimUserValue } from './scim-user-value.model';
import { ScimUser } from './scim-user.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';

/**
 * What reading a page of users needs from the SCIM service.
 */
export type ScimUserPages = {
    /**
     * Where the user resources are kept.
     */
    users: Repository<ScimUser>,
    /**
     * Where the values of their attributes are kept.
     */
    values: Repository<ScimUserValue>,
    /**
     * Finds the ids of the users holding a value the filter finds.
     */
    findValueHolders: (where: Where<ScimUserValue>) => Promise<string[]>,
    /**
     * Finds the resources among the given ones whose user is gone.
     */
    findOrphans: (scimUsers: ScimUser[]) => Promise<ScimUser[]>,
    /**
     * Removes resources whose user is gone.
     */
    removeOrphans: (orphans: ScimUser[]) => Promise<void>,
    /**
     * Answers the given users as the list asks for them.
     */
    resolveBodies: (scimUsers: ScimUser[]) => Promise<ScimBody[]>
};