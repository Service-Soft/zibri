import { type TaskLabelModel } from 'zibri-contract';

import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { Project } from './project.model';

/**
 * A label of a project its tasks can carry, such as `Bug`. Seen by whoever sees the project.
 */
@Entity({ allowOrphan: true, sharedThrough: 'project', indexes: [['projectId']] })
export class TaskLabel extends BaseTenantEntity() implements TaskLabelModel {
    /**
     * The project the label belongs to.
     */
    @Property.string({ format: 'uuid' })
    projectId!: string;

    /**
     * The name of the label.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The name of a color token of the frontend, such as `red-500`, never a color value.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.COLOR_MAX_LENGTH, regex: ZIBRI_PROJECTS_LIMITS.COLOR_REGEX })
    color!: string;

    /**
     * The project the label belongs to.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'labels' })
    project?: Project;
}
