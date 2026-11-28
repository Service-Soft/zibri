/**
 * A column of the board of a project, such as `To do` or `Done`, as the routes of the projects plugin answer it.
 */
export type ProjectColumnModel = {
    /**
     * The id of the column.
     */
    id: string,
    /**
     * The tenant the column belongs to.
     */
    tenantId: string,
    /**
     * The project whose board the column is on.
     */
    projectId: string,
    /**
     * The name of the column.
     */
    name: string,
    /**
     * Where the column is on the board: the columns are ordered by it, the lowest first.
     */
    position: number,
    /**
     * Whether a task in the column is done.
     */
    isDone: boolean
};
