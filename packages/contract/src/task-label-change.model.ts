/**
 * A change of a label, as `PATCH /projects/labels/:labelId` takes it. Each property is unchanged when absent.
 */
export type TaskLabelChangeModel = {
    /**
     * The name of the label.
     */
    name?: string,
    /**
     * The name of a color token of the frontend, matching `ZIBRI_PROJECTS_LIMITS.COLOR_REGEX`.
     */
    color?: string
};