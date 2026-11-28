import { type ProjectColumn } from './project-column.model';
import { type Project } from './project.model';
import { type TaskComment } from './task-comment.model';
import { type TaskLabel } from './task-label.model';
import { type Task } from './task.model';

// from zibri-contract, so that a frontend listens for the same event
// eslint-disable-next-line jsdoc/require-jsdoc
export { PROJECT_BOARD_WEBSOCKET_EVENT } from 'zibri-contract';

/**
 * A project as a message carries it, without its relations.
 */
type ProjectRow = Omit<Project, 'parent' | 'children' | 'columns' | 'tasks' | 'labels' | 'recurringTasks'>;

/**
 * A task as a message carries it, without its relations and change sets.
 */
type TaskRow = Omit<Task, 'project' | 'column' | 'comments' | 'changeSets'>;

/**
 * A column as a message carries it, without its relations.
 */
type ColumnRow = Omit<ProjectColumn, 'project' | 'tasks'>;

/**
 * A label as a message carries it, without its relation.
 */
type LabelRow = Omit<TaskLabel, 'project'>;

/**
 * A comment as a message carries it, without its relation.
 */
type CommentRow = Omit<TaskComment, 'task'>;

/**
 * A change of a board, as a connection subscribed to it through the `ProjectBoardWebsocketController` receives it as
 * the `data` of a message of `PROJECT_BOARD_WEBSOCKET_EVENT`, told apart by its `type`. `ProjectBoardMessageModel` of
 * `zibri-contract` is the same as it arrives as json.
 */
export type ProjectBoardMessage = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'project-updated',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    project: ProjectRow
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'project-deleted',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'task-created' | 'task-updated' | 'task-moved',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    task: TaskRow
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'task-deleted',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    taskId: string
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'column-created' | 'column-updated',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    column: ColumnRow
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'column-deleted',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    columnId: string
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'label-created' | 'label-updated',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    label: LabelRow
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'label-deleted',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    labelId: string
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'comment-created' | 'comment-updated',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    comment: CommentRow
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'comment-deleted',
    // eslint-disable-next-line jsdoc/require-jsdoc
    projectId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    taskId: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    commentId: string
};
