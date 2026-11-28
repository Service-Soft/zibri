import { Property } from '../../../entity/decorators/property.decorator';
import { PROJECT_ROLE_VALUES, type ProjectRole } from './project-role.model';
import { ProjectUser } from './project-user.model';

/**
 * A project shared with a user, as `GET /:projectId/shares` of the `ProjectsController` and `findShares` of the
 * project service answer it.
 */
export class ProjectShare {
    /**
     * The id of the share.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * The id of the user it is shared with.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The role it is shared in.
     */
    @Property.string({ enum: PROJECT_ROLE_VALUES })
    role!: ProjectRole;

    /**
     * The id of the user who shared it, or null.
     */
    @Property.string({ format: 'uuid', required: false })
    sharedBy?: string | null;

    /**
     * When it was shared, or its role last changed.
     */
    @Property.date()
    sharedAt!: Date;

    /**
     * The user it is shared with.
     */
    @Property.object({ cls: () => ProjectUser })
    user!: ProjectUser;
}
