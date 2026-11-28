/**
 * A task to create on the board of a project, as `POST /projects/:projectId/tasks` takes it.
 */
export type NewTaskModel = {
    /**
     * The id of the column of the project to create it in.
     */
    columnId: string,
    /**
     * The title of the task.
     */
    title: string,
    /**
     * What is to be done, as markdown.
     */
    description?: string | null,
    /**
     * The day the task is due on, such as `2027-07-31`, without a time.
     */
    dueOn?: string | null,
    /**
     * The ids of the users to assign it to, each one who sees the project.
     */
    assigneeIds?: string[],
    /**
     * The ids of labels of the project.
     */
    labelIds?: string[],
    /**
     * The id of a task of the same project it is a part of.
     */
    parentTaskId?: string | null,
    /**
     * The id of the task of the column to put it after, null to put it first. After the last task when absent.
     */
    afterTaskId?: string | null
};
