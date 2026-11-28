/**
 * Where to move a column on its board, as `POST /projects/columns/:columnId/move` takes it.
 */
export type ProjectColumnMoveModel = {
    /**
     * The id of the column to put it after, or null or nothing to put it first.
     */
    afterColumnId?: string | null
};