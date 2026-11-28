/**
 * What `GET /projects/tasks` takes in its query: a page of the tasks of the projects the caller sees, the soonest due
 * first, narrowed by what is given. It answers a `PaginationResult` of `TaskModel`.
 */
export type TaskQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many tasks a page holds, at most 100.
     */
    limit: number,
    /**
     * Only the tasks of this project.
     */
    projectId?: string,
    /**
     * Only the tasks whose title or description contains this text, in any case.
     */
    search?: string,
    /**
     * Only the tasks assigned to this user.
     */
    assigneeId?: string,
    /**
     * Whether the tasks of archived projects are listed as well. They are left out by default.
     */
    includeArchived?: boolean
};
