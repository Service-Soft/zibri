import { type ProjectCallerAccessModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { PROJECT_ROLE_VALUES, type ProjectRole } from './project-role.model';

/**
 * What the caller of a request may do on a project, as `GET /:projectId/board` and `GET /:projectId` of the
 * `ProjectsController` answer it.
 */
export class ProjectCallerAccess implements ProjectCallerAccessModel {
    /**
     * Their role on it: the highest of the role their permissions give, `viewer` with `projects.read` and `editor` with
     * `projects.write` beside it, and the roles it and the projects above it are shared with them in.
     */
    @Property.string({ enum: PROJECT_ROLE_VALUES })
    role!: ProjectRole;

    /**
     * Whether they see every project of the tenant. Otherwise they see the projects shared with them and the projects
     * below those.
     */
    @Property.boolean()
    fullAccess!: boolean;
}