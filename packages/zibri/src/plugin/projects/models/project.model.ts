import { BaseTenantEntity } from '../../../entity/base-tenant-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { NON_WORKING_DAY_RULE_VALUES, type NonWorkingDayRule } from './non-working-day-rule.model';
import { ProjectCalendarSync } from './project-calendar-sync.model';
import { ProjectColumn } from './project-column.model';
import { PROJECT_ROLES } from './project-role.model';
import { ZIBRI_PROJECTS_LIMITS } from './projects-limits.model';
import { ProjectsAccess } from './projects-access.model';
import { RecurringTask } from './recurring-task.model';
import { TaskLabel } from './task-label.model';
import { Task } from './task.model';

/**
 * A project of a tenant, with the board of its columns, tasks and labels. A project can have a parent, to any depth,
 * and a grouping project leaves its board empty. Shared with selected people: a member without `projects.read` sees
 * the projects shared with them and the projects below those, see `ShareServiceInterface`.
 */
@Entity({
    allowOrphan: true,
    shareable: { fullAccess: ProjectsAccess.READ, parent: 'parent', roles: PROJECT_ROLES }
})
export class Project extends BaseTenantEntity() {
    /**
     * The name of the project, such as `Website`.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * What the project is about, as markdown, or null for nothing. Stored as it is written, never as html.
     */
    @Property.string({ maxLength: ZIBRI_PROJECTS_LIMITS.DESCRIPTION_MAX_LENGTH, required: false })
    description?: string | null;

    /**
     * The id of the project it is below, or null for a project at the top.
     */
    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;

    /**
     * When the project was archived, or null for one that is not. Archiving a project archives the projects below it
     * that are not archived yet, at the same moment.
     */
    @Property.date({ required: false })
    archivedAt?: Date | null;

    /**
     * The working weekdays of its calendar, 0 for Sunday to 6 for Saturday, or null for those from above.
     */
    @Property.array({ items: { type: 'number', format: 'integer', min: 0, max: 6 }, required: false })
    workingWeekdays?: number[] | null;

    /**
     * The holiday calendar of its calendar, or null for the one from above.
     */
    @Property.string({ required: false })
    holidayCalendarId?: string | null;

    /**
     * What happens to a due date on a day that is not a working day, or null for what is said above.
     */
    @Property.string({ enum: NON_WORKING_DAY_RULE_VALUES, required: false })
    nonWorkingDay?: NonWorkingDayRule | null;

    /**
     * The calendar the due dates of its tasks are written into, or null for the one from above.
     */
    @Property.object({ cls: () => ProjectCalendarSync, required: false })
    calendarSync?: ProjectCalendarSync | null;

    /**
     * The project it is below.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'parentId', inverseSide: 'children', required: false })
    parent?: Project;

    /**
     * The projects directly below it.
     */
    @Property.oneToMany({ target: () => Project, inverseSide: 'parent', required: false })
    children?: Project[];

    /**
     * The columns of its board.
     */
    @Property.oneToMany({ target: () => ProjectColumn, inverseSide: 'project', required: false })
    columns?: ProjectColumn[];

    /**
     * Its tasks.
     */
    @Property.oneToMany({ target: () => Task, inverseSide: 'project', required: false })
    tasks?: Task[];

    /**
     * The labels its tasks can carry.
     */
    @Property.oneToMany({ target: () => TaskLabel, inverseSide: 'project', required: false })
    labels?: TaskLabel[];

    /**
     * Its recurring tasks.
     */
    @Property.oneToMany({ target: () => RecurringTask, inverseSide: 'project', required: false })
    recurringTasks?: RecurringTask[];
}
