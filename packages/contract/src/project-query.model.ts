/**
 * What `GET /projects` takes in its query: a page of the projects the caller sees, by name, narrowed by what is given.
 * It answers a `PaginationResult` of `ProjectModel`.
 */
export type ProjectQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many projects a page holds, at most 100.
     */
    limit: number,
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
