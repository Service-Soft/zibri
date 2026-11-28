import { type NewProjectShareModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { PROJECT_ROLE_VALUES, type ProjectRole } from './project-role.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * Whom to share a project with by email, as `POST /:projectId/shares` of the `ProjectsController` and `shareByEmail`
 * of the project service take it.
 */
export class NewProjectShare implements NewProjectShareModel {
    /**
     * The email address to share it with.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * Who is invited, as the person sharing writes their name.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The role to share it in.
     */
    @Property.string({ enum: PROJECT_ROLE_VALUES })
    role!: ProjectRole;

    /**
     * Whether the account the invitation creates gets no password, and logs in with a link sent by email.
     */
    @Property.boolean({ required: false })
    withoutPassword?: boolean;
}