import { type ProjectColumnModel } from './project-column.model';
import { type ProjectModel } from './project.model';
import { type TaskCommentModel } from './task-comment.model';
import { type TaskLabelModel } from './task-label.model';
import { type TaskModel } from './task.model';

/**
 * The websocket event a change of a board a connection subscribed to arrives as. The `data` of its message is a
 * {@link ProjectBoardMessageModel}.
 */
export const PROJECT_BOARD_WEBSOCKET_EVENT: 'zi.projects.board' = 'zi.projects.board';

/**
 * A project changed: renamed, moved, archived or brought back.
 */
export type ProjectUpdatedMessageModel = {
    /**
     * What changed.
     */
    type: 'project-updated',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The project, as it is now.
     */
    project: ProjectModel
};

/**
 * A project was deleted, with its board.
 */
export type ProjectDeletedMessageModel = {
    /**
     * What changed.
     */
    type: 'project-deleted',
    /**
     * The project whose board it was.
     */
    projectId: string
};

/**
 * A task was created, changed or moved.
 */
export type TaskWrittenMessageModel = {
    /**
     * What changed.
     */
    type: 'task-created' | 'task-updated' | 'task-moved',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The task, as it is now, without its change sets.
     */
    task: Omit<TaskModel, 'changeSets'>
};

/**
 * A task was deleted, with its comments.
 */
export type TaskDeletedMessageModel = {
    /**
     * What changed.
     */
    type: 'task-deleted',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The id of the task.
     */
    taskId: string
};

/**
 * A column was added, changed or moved.
 */
export type ColumnWrittenMessageModel = {
    /**
     * What changed.
     */
    type: 'column-created' | 'column-updated',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The column, as it is now.
     */
    column: ProjectColumnModel
};

/**
 * A column was deleted.
 */
export type ColumnDeletedMessageModel = {
    /**
     * What changed.
     */
    type: 'column-deleted',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The id of the column.
     */
    columnId: string
};

/**
 * A label was added or changed.
 */
export type LabelWrittenMessageModel = {
    /**
     * What changed.
     */
    type: 'label-created' | 'label-updated',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The label, as it is now.
     */
    label: TaskLabelModel
};

/**
 * A label was deleted, and taken off every task carrying it.
 */
export type LabelDeletedMessageModel = {
    /**
     * What changed.
     */
    type: 'label-deleted',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The id of the label.
     */
    labelId: string
};

/**
 * A comment was written or changed.
 */
export type CommentWrittenMessageModel = {
    /**
     * What changed.
     */
    type: 'comment-created' | 'comment-updated',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The comment, as it is now.
     */
    comment: TaskCommentModel
};

/**
 * A comment was deleted.
 */
export type CommentDeletedMessageModel = {
    /**
     * What changed.
     */
    type: 'comment-deleted',
    /**
     * The project whose board it is.
     */
    projectId: string,
    /**
     * The task the comment was on.
     */
    taskId: string,
    /**
     * The id of the comment.
     */
    commentId: string
};

/**
 * A change of a board, as a connection subscribed to it receives it under {@link PROJECT_BOARD_WEBSOCKET_EVENT}, told
 * apart by its `type`.
 */
export type ProjectBoardMessageModel = ProjectUpdatedMessageModel
    | ProjectDeletedMessageModel
    | TaskWrittenMessageModel
    | TaskDeletedMessageModel
    | ColumnWrittenMessageModel
    | ColumnDeletedMessageModel
    | LabelWrittenMessageModel
    | LabelDeletedMessageModel
    | CommentWrittenMessageModel
    | CommentDeletedMessageModel;
