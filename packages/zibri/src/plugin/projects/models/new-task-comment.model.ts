import { type NewTaskCommentModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';

/**
 * A comment to write on a task, or the new text of one, as `POST /tasks/:taskId/comments` and
 * `PATCH /comments/:commentId` of the `ProjectsController` take it.
 */
export class NewTaskComment implements NewTaskCommentModel {
    /**
     * What it says, as markdown.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.COMMENT_MAX_LENGTH })
    text!: string;
}
