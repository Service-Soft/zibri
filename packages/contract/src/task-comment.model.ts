/**
 * A comment on a task, as the routes of the projects plugin answer it.
 */
export type TaskCommentModel = {
    /**
     * The id of the comment.
     */
    id: string,
    /**
     * The tenant the comment belongs to.
     */
    tenantId: string,
    /**
     * The task the comment is on.
     */
    taskId: string,
    /**
     * The id of the user who wrote it.
     */
    authorId: string,
    /**
     * What it says, as markdown.
     */
    text: string,
    /**
     * When it was written.
     */
    createdAt: string,
    /**
     * When its author last changed it, or null for a comment never changed.
     */
    editedAt?: string | null
};
