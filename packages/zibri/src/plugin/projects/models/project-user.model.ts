import { type ProjectUserModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A user as the routes of the projects plugin show them, such as an assignee or the author of a comment: by name, and
 * by email address only to a caller who sees every project of the tenant. To any other caller it is a
 * `SharedUserModel` of `zibri-contract`.
 */
export class ProjectUser implements ProjectUserModel {
    /**
     * The id of the user.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * The name the application shows for them, as `findUsers` of the plugin options answers it.
     */
    @Property.string()
    name!: string;

    /**
     * Their email address, for a caller who sees every project of the tenant alone.
     */
    @Property.string({ required: false })
    email?: string;
}