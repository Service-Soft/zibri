/* eslint-disable jsdoc/require-jsdoc */
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { type TenantWebDavConnectionUsageFinderInterface } from '../../web-dav/tenant-web-dav-connection-usage-finder.interface';
import { ProjectsPluginOptionsInput } from './models/projects-plugin-options-input.model';
import { ProjectsPluginOptions } from './models/projects-plugin-options.model';
import { type HolidayCalendarInterface } from './services/holiday-calendar.interface';
import { type ProjectAccessServiceInterface } from './services/project-access-service.interface';
import { type ProjectBoardUpdateServiceInterface } from './services/project-board-update-service.interface';
import { type ProjectServiceInterface } from './services/project-service.interface';
import { type RecurringTaskServiceInterface } from './services/recurring-task-service.interface';
import { type TaskCalendarSyncServiceInterface } from './services/task-calendar-sync-service.interface';
import { type TaskServiceInterface } from './services/task-service.interface';
import { type WorkingCalendarServiceInterface } from './services/working-calendar-service.interface';

/**
 * The dependency injection tokens used by the ZibriProjectsPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PROJECTS_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: projectsToken<ProjectsPluginOptionsInput>('zi.projects.options_input'),
    OPTIONS: projectsToken<ProjectsPluginOptions>('zi.projects.options'),
    PROJECT_SERVICE: projectsToken<ProjectServiceInterface>('zi.projects.project_service'),
    TASK_SERVICE: projectsToken<TaskServiceInterface>('zi.projects.task_service'),
    PROJECT_ACCESS_SERVICE: projectsToken<ProjectAccessServiceInterface>('zi.projects.project_access_service'),
    PROJECT_BOARD_UPDATE_SERVICE: projectsToken<ProjectBoardUpdateServiceInterface>('zi.projects.project_board_update_service'),
    RECURRING_TASK_SERVICE: projectsToken<RecurringTaskServiceInterface>('zi.projects.recurring_task_service'),
    WORKING_CALENDAR_SERVICE: projectsToken<WorkingCalendarServiceInterface>('zi.projects.working_calendar_service'),
    TASK_CALENDAR_SYNC_SERVICE: projectsToken<TaskCalendarSyncServiceInterface>('zi.projects.task_calendar_sync_service'),
    // the holidays of the calendars the application knows, none unless it provides them
    HOLIDAY_CALENDAR: projectsToken<HolidayCalendarInterface>('zi.projects.holiday_calendar'),
    // which keeps a WebDAV connection a calendar names from being deleted
    CALENDAR_USAGE_FINDER: projectsToken<TenantWebDavConnectionUsageFinderInterface>('zi.projects.calendar_usage_finder')
} as const satisfies TokenRecord;

function projectsToken<T = never>(k: `zi.projects.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}
