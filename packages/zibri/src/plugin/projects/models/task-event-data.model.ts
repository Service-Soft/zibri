/**
 * What the events of tasks carry: the task, the project it belongs to and the column it is in. A hook reads the task
 * for anything else, as it stands when the hook runs.
 */
export type TaskEventData = {
    /**
     * The id of the task.
     */
    taskId: string,
    /**
     * The id of its project.
     */
    projectId: string,
    /**
     * The id of the column it is in.
     */
    columnId: string
};