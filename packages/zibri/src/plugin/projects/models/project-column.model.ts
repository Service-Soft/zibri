import { type ProjectColumnModel } from 'zibri-contract';

import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Project } from './project.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { Task } from './task.model';

/**
 * A column of the board of a project, such as `To do` or `Done`. Seen by whoever sees the project.
 */
@Entity({ allowOrphan: true, sharedThrough: 'project', indexes: [['projectId', 'position']] })
export class ProjectColumn extends BaseTenantEntity() implements ProjectColumnModel {
    /**
     * The project whose board the column is on.
     */
    @Property.string({ format: 'uuid' })
    projectId!: string;

    /**
     * The name of the column.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * Where the column is on the board: the columns are ordered by it, the lowest first.
     */
    @Property.number()
    position!: number;

    /**
     * Whether a task in the column is done.
     */
    @Property.boolean()
    isDone!: boolean;

    /**
     * The project whose board the column is on.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'columns' })
    project?: Project;

    /**
     * The tasks in the column. The project service refuses to delete a column holding tasks.
     */
    // removed along with the column, so that a project deleted with its columns and tasks removes them in whichever
    // order its relations reach them: a column is deleted on its own only once it holds no task
    @Property.oneToMany({ target: () => Task, inverseSide: 'column', required: false })
    tasks?: Task[];
}