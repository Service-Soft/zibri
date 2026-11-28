import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A task to create on the board of a project, as `POST /:projectId/tasks` of the `ProjectsController` and
 * `createTask` of the task service take it.
 */
export class NewTask {
    /**
     * The id of the column of the project to create it in.
     */
    @Property.string({ format: 'uuid' })
    columnId!: string;

    /**
     * The title of the task.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH })
    title!: string;

    /**
     * What is to be done, as markdown.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The day the task is due on, such as `2027-07-31`, without a time.
     */
    @Property.date({ required: false })
    dueOn?: Date | null;

    /**
     * The ids of the users to assign it to, each one who sees the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    assigneeIds?: string[];

    /**
     * The ids of labels of the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' }, required: false })
    labelIds?: string[];

    /**
     * The id of a task of the same project it is a part of.
     */
    @Property.string({ format: 'uuid', required: false })
    parentTaskId?: string | null;

    /**
     * The id of the task of the column to put it after, null to put it first. After the last task when absent.
     */
    @Property.string({ format: 'uuid', required: false })
    afterTaskId?: string | null;
}
