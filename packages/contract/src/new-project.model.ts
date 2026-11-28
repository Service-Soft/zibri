/**
 * A project to create, as `POST /projects` takes it.
 */
export type NewProjectModel = {
    /**
     * The name of the project, such as `Website`.
     */
    name: string,
    /**
     * What the project is about, as markdown.
     */
    description?: string | null,
    /**
     * The id of the project to create it below, or null for one at the top.
     */
    parentId?: string | null
};