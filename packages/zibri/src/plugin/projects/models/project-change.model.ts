import { type ProjectChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A change of a project, as `PATCH /:projectId` of the `ProjectsController` and `updateProject` of the project service
 * take it. Each property is unchanged when absent.
 */
export class ProjectChange implements ProjectChangeModel {
    /**
     * The name of the project.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH, required: false })
    name?: string;

    /**
     * What the project is about, as markdown, or null for nothing.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The id of the project to move it below, or null to move it to the top.
     */
    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;
}