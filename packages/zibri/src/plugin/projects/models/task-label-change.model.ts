import { type TaskLabelChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A change of a label, as `PATCH /labels/:labelId` of the `ProjectsController` and `updateLabel` of the project
 * service take it. Each property is unchanged when absent.
 */
export class TaskLabelChange implements TaskLabelChangeModel {
    /**
     * The name of the label.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH, required: false })
    name?: string;

    /**
     * The name of a color token of the frontend, such as `red-500`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.COLOR_MAX_LENGTH, regex: ZIBRI_PROJECTS_LIMITS.COLOR_REGEX, required: false })
    color?: string;
}