import { type ProjectShareModel } from './project-share.model';

/**
 * What sharing a project by email did, as `POST /projects/:projectId/shares` answers it: shared it with the member the
 * email belongs to, or invited the email, which gets the share once it accepts.
 */
export type ProjectShareResultModel = {
    /**
     * The share, for the email of a member of the tenant, else null.
     */
    share: ProjectShareModel | null,
    /**
     * The id of the invitation sent, for any other email, else null.
     */
    invitationId: string | null
};