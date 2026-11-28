import { Property } from '../../../entity/decorators/property.decorator';
import { ProjectShare } from './project-share.model';

/**
 * What sharing a project by email did, as `POST /:projectId/shares` of the `ProjectsController` and `shareByEmail` of
 * the project service answer it: shared it with the member the email belongs to, or invited the email, which gets the
 * share once it accepts.
 */
export class ProjectShareResult {
    /**
     * The share, for the email of a member of the tenant, else null.
     */
    @Property.object({ cls: () => ProjectShare, required: false })
    share!: ProjectShare | null;

    /**
     * The id of the invitation sent, for any other email, else null.
     */
    @Property.string({ format: 'uuid', required: false })
    invitationId!: string | null;
}
