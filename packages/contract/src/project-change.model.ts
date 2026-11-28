/**
 * A change of a project, as `PATCH /projects/:projectId` takes it. Each property is unchanged when absent.
 */
export type ProjectChangeModel = {
    /**
     * The name of the project.
     */
    name?: string,
    /**
     * What the project is about, as markdown, or null for nothing.
     */
    description?: string | null,
    /**
     * The id of the project to move it below, or null to move it to the top. Neither the project itself nor a project
     * below it.
     */
    parentId?: string | null
};
