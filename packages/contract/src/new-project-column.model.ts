/**
 * A column to add to the board of a project, as `POST /projects/:projectId/columns` takes it.
 */
export type NewProjectColumnModel = {
    /**
     * The name of the column, such as `In review`.
     */
    name: string,
    /**
     * Whether a task in the column is done. False by default.
     */
    isDone?: boolean,
    /**
     * The id of the column to put it after, null to put it first. After the last column when absent.
     */
    afterColumnId?: string | null
};
