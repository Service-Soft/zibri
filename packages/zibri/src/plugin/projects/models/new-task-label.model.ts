import { type NewTaskLabelModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A label to add to a project, as `POST /:projectId/labels` of the `ProjectsController` and `createLabel` of the
 * project service take it.
 */
export class NewTaskLabel implements NewTaskLabelModel {
    /**
     * The name of the label, such as `Bug`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The name of a color token of the frontend, such as `red-500`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.COLOR_MAX_LENGTH, regex: ZIBRI_PROJECTS_LIMITS.COLOR_REGEX })
    color!: string;
}