import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A change of a task, as `PATCH /tasks/:taskId` of the `ProjectsController` and `updateTask` of the task service take
 * it. Each property is unchanged when absent. Its column and place change by moving it.
 */
export class TaskChange {
    /**
     * The title of the task.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH, required: false })
    title?: string;

    /**
     * What is to be done, as markdown, or null for nothing.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The day the task is due on, such as `2027-07-31`, without a time, or null for no date.
     */
    @Property.date({ required: false })
    dueOn?: Date | null;

    /**
     * The ids of the users it is assigned to, each one who sees the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    assigneeIds?: string[];

    /**
     * The ids of labels of the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    labelIds?: string[];

    /**
     * The id of a task of the same project it is a part of, or null.
     */
    @Property.string({ format: 'uuid', required: false })
    parentTaskId?: string | null;
}
