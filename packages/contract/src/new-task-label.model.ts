/**
 * A label to add to a project, as `POST /projects/:projectId/labels` takes it.
 */
export type NewTaskLabelModel = {
    /**
     * The name of the label, such as `Bug`.
     */
    name: string,
    /**
     * The name of a color token of the frontend, such as `red-500`, matching `ZIBRI_PROJECTS_LIMITS.COLOR_REGEX`.
     */
    color: string
};