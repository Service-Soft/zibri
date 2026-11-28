/**
 * Which tasks `findTasks` of the task service answers, of the projects the caller sees. Each property narrows the
 * list when given.
 */
export type TaskFilter = {
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
