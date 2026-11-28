/**
 * A change of a task, as `PATCH /projects/tasks/:taskId` takes it. Each property is unchanged when absent. Its column
 * and place change by moving it.
 */
export type TaskChangeModel = {
    /**
     * The title of the task.
     */
    title?: string,
    /**
     * What is to be done, as markdown, or null for nothing.
     */
    description?: string | null,
    /**
     * The day the task is due on, such as `2027-07-31`, without a time, or null for no date.
     */
    dueOn?: string | null,
    /**
     * The ids of the users it is assigned to, each one who sees the project.
     */
    assigneeIds?: string[],
    /**
     * The ids of labels of the project.
     */
    labelIds?: string[],
    /**
     * The id of a task of the same project it is a part of, or null. Neither the task itself nor a part of it.
     */
    parentTaskId?: string | null
};
