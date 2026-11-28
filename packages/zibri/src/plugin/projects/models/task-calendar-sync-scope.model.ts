/**
 * What a request to sync the calendars is about: one task, the tasks of a project and of the projects below it that
 * take its calendar, or those of every project of the tenant.
 */
export type TaskCalendarSyncScope = 'task' | 'project' | 'tenant';

/**
 * The scopes by themselves, as the `enum` of a property takes them.
 */
export const TASK_CALENDAR_SYNC_SCOPE_VALUES: Record<TaskCalendarSyncScope, TaskCalendarSyncScope> = {
    task: 'task',
    project: 'project',
    tenant: 'tenant'
};
