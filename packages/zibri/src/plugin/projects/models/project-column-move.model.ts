import { type ProjectColumnMoveModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Where to move a column on its board, as `POST /columns/:columnId/move` of the `ProjectsController` and `moveColumn`
 * of the project service take it.
 */
export class ProjectColumnMove implements ProjectColumnMoveModel {
    /**
     * The id of the column to put it after, or null or nothing to put it first.
     */
    @Property.string({ format: 'uuid', required: false })
    afterColumnId?: string | null;
}
