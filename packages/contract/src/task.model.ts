import { type ChangeSet } from './change-set.model';

/**
 * A task on the board of a project, as the routes of the projects plugin answer it.
 */
export type TaskModel = {
    /**
     * The id of the task.
     */
    id: string,
    /**
     * The tenant the task belongs to.
     */
    tenantId: string,
    /**
     * The project the task belongs to.
     */
    projectId: string,
    /**
     * The column of the board the task is in.
     */
    columnId: string,
    /**
     * The title of the task.
     */
    title: string,
    /**
     * What is to be done, as markdown, or null for nothing.
     */
    description?: string | null,
    /**
     * Where the task is in its column: the tasks are ordered by it, the lowest first.
     */
    position: number,
    /**
     * The day the task is due on, or null for no date: its midnight UTC, such as `2027-07-31T00:00:00.000Z`, whose
     * first ten characters are the day. The same day in every time zone.
     */
    dueOn?: string | null,
    /**
     * The ids of the users the task is assigned to.
     */
    assigneeIds: string[],
    /**
     * The ids of the labels of the project the task carries.
     */
    labelIds: string[],
    /**
     * When the task was moved into a column whose tasks are done, or null while it is in another.
     */
    doneAt?: string | null,
    /**
     * The id of the task of the same project it is a part of, or null.
     */
    parentTaskId?: string | null,
    /**
     * The id of the recurring task it is an occurrence of, or null.
     */
    recurringTaskId?: string | null,
    /**
     * Who changed what of the task and when, oldest first. Answered by `GET /projects/tasks/:taskId` alone.
     */
    changeSets?: ChangeSet[]
};
