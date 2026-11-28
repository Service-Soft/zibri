import * as contract from 'zibri-contract';

import { type ProjectBoardMessageColumn } from './project-board-message-column.model';
import { type ProjectBoardMessageComment } from './project-board-message-comment.model';
import { type ProjectBoardMessageLabel } from './project-board-message-label.model';
import { type ProjectBoardMessageProject } from './project-board-message-project.model';
import { type ProjectBoardMessageTask } from './project-board-message-task.model';

// the value of zibri-contract, so that a frontend listens for the same event, declared here rather than re-exported
// so that its JSDoc names the message as the server sends it, not the model of the contract
/**
 * The websocket event a change of a board a connection subscribed to arrives as. The `data` of its message is a
 * {@link ProjectBoardMessage}.
 */
export const PROJECT_BOARD_WEBSOCKET_EVENT: typeof contract.PROJECT_BOARD_WEBSOCKET_EVENT = contract.PROJECT_BOARD_WEBSOCKET_EVENT;

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
    project: ProjectBoardMessageProject
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
    task: ProjectBoardMessageTask
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
    column: ProjectBoardMessageColumn
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
    label: ProjectBoardMessageLabel
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
    comment: ProjectBoardMessageComment
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