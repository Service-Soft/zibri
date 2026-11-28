/**
 * A comment to write on a task, or the new text of one, as `POST /projects/tasks/:taskId/comments` and
 * `PATCH /projects/comments/:commentId` take it.
 */
export type NewTaskCommentModel = {
    /**
     * What it says, as markdown.
     */
    text: string
};
