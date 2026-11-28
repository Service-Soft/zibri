import { type ProjectColumnChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A change of a column, as `PATCH /columns/:columnId` of the `ProjectsController` and `updateColumn` of the project
 * service take it. Each property is unchanged when absent.
 */
export class ProjectColumnChange implements ProjectColumnChangeModel {
    /**
     * The name of the column.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH, required: false })
    name?: string;

    /**
     * Whether a task in the column is done. Its tasks are done from then on, or no longer.
     */
    @Property.boolean({ required: false })
    isDone?: boolean;
}
