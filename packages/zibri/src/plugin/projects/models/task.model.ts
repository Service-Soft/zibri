import { ChangeSetEntity } from '../../../data-source/change-sets/models/change-set-entity.model';
import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ProjectColumn } from './project-column.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { Project } from './project.model';
import { TaskComment } from './task-comment.model';

/**
 * A task on the board of a project, whose changes are recorded as change sets with the user who made them. Seen by
 * whoever sees the project.
 */
@Entity({ allowOrphan: true, sharedThrough: 'project', indexes: [['columnId', 'position'], ['projectId', 'dueOn']] })
export class Task extends BaseTenantEntity(ChangeSetEntity) {
    /**
     * The project the task belongs to.
     */
    @Property.string({ format: 'uuid' })
    projectId!: string;

    /**
     * The column of the board the task is in, one of its project.
     */
    @Property.string({ format: 'uuid' })
    columnId!: string;

    /**
     * The title of the task.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.TITLE_MAX_LENGTH })
    title!: string;

    /**
     * What is to be done, as markdown, or null for nothing. Stored as it is written, never as html.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * Where the task is in its column: the tasks are ordered by it, the lowest first.
     */
    // left out of the change sets: a place among the other tasks is no change of the task worth a record, and a
    // column whose places ran out of precision rewrites the place of every task in it
    @Property.number({ excludeFromChangeSets: true })
    position!: number;

    /**
     * The day the task is due on, at its midnight UTC, such as `2027-07-31`, or null for no date. The same day in every
     * time zone.
     */
    @Property.date({ required: false })
    dueOn?: Date | null;

    /**
     * The ids of the users the task is assigned to, each one who sees the project.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' } })
    assigneeIds!: string[];

    /**
     * The ids of the labels of the project the task carries.
     */
    @Property.array({ items: { type: 'string', format: 'uuid' } })
    labelIds!: string[];

    /**
     * When the task was moved into a column whose tasks are done, or null while it is in another.
     */
    @Property.date({ required: false })
    doneAt?: Date | null;

    /**
     * The id of the task of the same project it is a part of, or null.
     */
    @Property.string({ format: 'uuid', required: false })
    parentTaskId?: string | null;

    /**
     * The id of the recurring task it is an occurrence of, or null. Null again once the recurring task is deleted.
     */
    @Property.string({ format: 'uuid', required: false })
    recurringTaskId?: string | null;

    /**
     * The project the task belongs to.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'tasks' })
    project?: Project;

    /**
     * The column the task is in.
     */
    @Property.manyToOne({ target: () => ProjectColumn, joinColumn: 'columnId', inverseSide: 'tasks' })
    column?: ProjectColumn;

    /**
     * The comments on the task.
     */
    @Property.oneToMany({ target: () => TaskComment, inverseSide: 'task', required: false })
    comments?: TaskComment[];
}
