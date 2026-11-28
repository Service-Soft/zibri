import { type TaskMoveModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Where to move a task, as `POST /tasks/:taskId/move` of the `ProjectsController` and `moveTask` of the task service
 * take it: a column of its project, and its place in that column.
 */
export class TaskMove implements TaskMoveModel {
    /**
     * The id of the column to move it into.
     */
    @Property.string({ format: 'uuid' })
    columnId!: string;

    /**
     * The id of the task of that column to put it after, or null or nothing to put it first.
     */
    @Property.string({ format: 'uuid', required: false })
    afterTaskId?: string | null;
}
