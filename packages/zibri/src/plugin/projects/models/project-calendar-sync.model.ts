import { type ProjectCalendarSyncModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { ProjectCalendarSyncTarget } from './project-calendar-sync-target.model';

/**
 * Which calendar a project or the tenant writes the due dates of its tasks into, as it sets it itself: a calendar,
 * or none.
 */
// a calendar or none wrapped, rather than the calendar alone: null of the property it is held in already means the
// calendar from above, and a project below one that syncs has to be able to say that it syncs nothing
export class ProjectCalendarSync implements ProjectCalendarSyncModel {
    /**
     * The calendar, or null for none.
     */
    @Property.object({ cls: () => ProjectCalendarSyncTarget, required: false })
    target!: ProjectCalendarSyncTarget | null;
}
