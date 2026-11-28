import { type NewProjectModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A project to create, as `POST /` of the `ProjectsController` and `createProject` of the project service take it.
 */
export class NewProject implements NewProjectModel {
    /**
     * The name of the project, such as `Website`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * What the project is about, as markdown.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The id of the project to create it below, or null for one at the top.
     */
    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;
}