import { type ProjectShareRoleModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { PROJECT_ROLE_VALUES, type ProjectRole } from './project-role.model';

/**
 * The role to share a project with a member of the tenant in, as `PUT /:projectId/shares/:userId` of the
 * `ProjectsController` takes it.
 */
export class ProjectShareRole implements ProjectShareRoleModel {
    /**
     * The role.
     */
    @Property.string({ enum: PROJECT_ROLE_VALUES })
    role!: ProjectRole;
}
