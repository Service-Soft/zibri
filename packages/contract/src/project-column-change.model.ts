/**
 * A change of a column, as `PATCH /projects/columns/:columnId` takes it. Each property is unchanged when absent.
 */
export type ProjectColumnChangeModel = {
    /**
     * The name of the column.
     */
    name?: string,
    /**
     * Whether a task in the column is done. Its tasks are done from then on, or no longer.
     */
    isDone?: boolean
};
