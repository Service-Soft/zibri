/**
 * A label of a project its tasks can carry, as the routes of the projects plugin answer it.
 */
export type TaskLabelModel = {
    /**
     * The id of the label.
     */
    id: string,
    /**
     * The tenant the label belongs to.
     */
    tenantId: string,
    /**
     * The project the label belongs to.
     */
    projectId: string,
    /**
     * The name of the label, such as `Bug`.
     */
    name: string,
    /**
     * The name of a color token of the frontend, such as `red-500`, never a color value.
     */
    color: string
};