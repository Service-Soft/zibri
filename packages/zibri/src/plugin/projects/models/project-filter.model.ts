/**
 * Which projects `findProjects` of the project service answers, of those the caller sees. Each property narrows the
 * list when given.
 */
export type ProjectFilter = {
    /**
     * Only the projects directly below this one.
     */
    parentId?: string,
    /**
     * Only the projects whose name contains this text, in any case.
     */
    search?: string,
    /**
     * Whether archived projects are listed as well. They are left out by default.
     */
    includeArchived?: boolean
};
