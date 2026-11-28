import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { Task } from './task.model';

/**
 * A comment on a task. Seen by whoever sees the project of the task.
 */
@Entity({ allowOrphan: true, sharedThrough: 'task', indexes: [['taskId', 'createdAt']] })
export class TaskComment extends BaseTenantEntity() {
    /**
     * The task the comment is on.
     */
    @Property.string({ format: 'uuid' })
    taskId!: string;

    /**
     * The id of the user who wrote it.
     */
    @Property.string({ format: 'uuid' })
    authorId!: string;

    /**
     * What it says, as markdown. Stored as it is written, never as html.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.COMMENT_MAX_LENGTH })
    text!: string;

    /**
     * When it was written.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * When its author last changed it, or null for a comment never changed.
     */
    @Property.date({ required: false })
    editedAt?: Date | null;

    /**
     * The task the comment is on.
     */
    @Property.manyToOne({ target: () => Task, joinColumn: 'taskId', inverseSide: 'comments' })
    task?: Task;
}
