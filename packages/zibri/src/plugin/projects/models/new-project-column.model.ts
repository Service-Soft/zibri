import { type NewProjectColumnModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A column to add to the board of a project, as `POST /:projectId/columns` of the `ProjectsController` and
 * `createColumn` of the project service take it.
 */
export class NewProjectColumn implements NewProjectColumnModel {
    /**
     * The name of the column, such as `In review`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * Whether a task in the column is done. False by default.
     */
    @Property.boolean({ required: false })
    isDone?: boolean;

    /**
     * The id of the column to put it after, null to put it first. After the last column when absent.
     */
    @Property.string({ format: 'uuid', required: false })
    afterColumnId?: string | null;
}
