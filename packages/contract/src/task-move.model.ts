/**
 * Where to move a task, as `POST /projects/tasks/:taskId/move` takes it: a column of its project, and its place in
 * that column.
 */
export type TaskMoveModel = {
    /**
     * The id of the column to move it into.
     */
    columnId: string,
    /**
     * The id of the task of that column to put it after, or null or nothing to put it first.
     */
    afterTaskId?: string | null
};