import { ZibriApplication } from '../../application/application';
import { CalendarEntryLink } from '../../calendar-sync/calendar-entry-link.model';
import { CronJob } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Lease } from '../../leases/lease.model';
import { RowShare } from '../../sharing/row-share.model';
import { Newable } from '../../types/newable.type';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { ZibriPlugin } from '../plugin.model';
import { ProjectCalendarDefaults } from './models/project-calendar-defaults.model';
import { ProjectColumn } from './models/project-column.model';
import { Project } from './models/project.model';
import { ProjectsPluginOptionsInput } from './models/projects-plugin-options-input.model';
import { ProjectsPluginOptions } from './models/projects-plugin-options.model';
import { RecurringTaskOccurrence } from './models/recurring-task-occurrence.model';
import { RecurringTask } from './models/recurring-task.model';
import { TaskCalendarSyncRequest } from './models/task-calendar-sync-request.model';
import { TaskComment } from './models/task-comment.model';
import { TaskLabel } from './models/task-label.model';
import { Task } from './models/task.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';
import { RecurringTaskCronJob } from './recurring-task.cron-job';
import { EmptyHolidayCalendar } from './services/empty-holiday-calendar.service';
import { ProjectAccessService } from './services/project-access.service';
import { ProjectBoardUpdateService } from './services/project-board-update.service';
import { ProjectCalendarUsageFinder } from './services/project-calendar-usage-finder.service';
import { ProjectService } from './services/project.service';
import { RecurringTaskService } from './services/recurring-task.service';
import { TaskCalendarSyncService } from './services/task-calendar-sync.service';
import { TaskService } from './services/task.service';
import { WorkingCalendarService } from './services/working-calendar.service';
import { TaskCalendarSyncWriteObserver } from './task-calendar-sync.write-observer';

/**
 * Plugin for the projects of a tenant, each with a board of columns, tasks and labels, the comments on the tasks and
 * the history of each task, recurring tasks kept to a working calendar, the due dates of tasks written into a calendar,
 * sharing a project with selected people, and the changes of a board pushed live over the websocket.
 */
export class ZibriProjectsPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_PROJECTS_PLUGIN_DI_TOKENS> = {
        // the guest roles, how a user is named, how long an invitation lasts and whether due dates are written into
        // calendars, only the application knows
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: ProjectsPluginOptionsInput = inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const res: ProjectsPluginOptions = { invitationColumns: () => ({}), eventNames: {}, ...input };
                return res;
            }
        },
        PROJECT_SERVICE: { useClass: ProjectService },
        TASK_SERVICE: { useClass: TaskService },
        PROJECT_ACCESS_SERVICE: { useClass: ProjectAccessService },
        PROJECT_BOARD_UPDATE_SERVICE: { useClass: ProjectBoardUpdateService },
        RECURRING_TASK_SERVICE: { useClass: RecurringTaskService },
        WORKING_CALENDAR_SERVICE: { useClass: WorkingCalendarService },
        TASK_CALENDAR_SYNC_SERVICE: { useClass: TaskCalendarSyncService },
        HOLIDAY_CALENDAR: { useClass: EmptyHolidayCalendar },
        CALENDAR_USAGE_FINDER: { useClass: ProjectCalendarUsageFinder, variants: [DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER] }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override cronJobs: Newable<CronJob>[] = [RecurringTaskCronJob];

    // registers TaskCalendarSyncCronJob as well, for an application that syncs calendars
    override additionalLifecycleServices: Newable<unknown>[] = [TaskCalendarSyncWriteObserver];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        const options: ProjectsPluginOptions = inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS);
        const entities: Newable<BaseEntity>[] = [
            Project,
            ProjectColumn,
            Task,
            TaskLabel,
            TaskComment,
            RecurringTask,
            RecurringTaskOccurrence,
            ProjectCalendarDefaults,
            // queued in the transaction of the change of a task
            ...options.calendarSync == undefined ? [] : [TaskCalendarSyncRequest]
        ];
        validateEntitiesRegistered(
            this.constructor.name,
            app,
            ...entities,
            RowShare,
            Lease,
            ...options.calendarSync == undefined ? [] : [TenantWebDavConnection, CalendarEntryLink]
        );
        validateTokensRegistered(this.constructor.name, ZIBRI_PROJECTS_PLUGIN_DI_TOKENS);
        // a project is deleted with its board in one transaction, a label with the tasks it is taken off, an
        // occurrence is created with its task, and a request to sync the calendars with the change it is of
        const projects: Repository<Project> = inject(repositoryTokenFor(Project));
        const elsewhere: Newable<BaseEntity> | undefined = entities
            .find(entity => inject<Repository<BaseEntity>>(repositoryTokenFor(entity)).dataSource !== projects.dataSource);
        if (elsewhere != undefined) {
            throw new InternalError(`${this.constructor.name} needs ${elsewhere.name} in the data source of Project.`);
        }
        if (!options.guestRoles.length) {
            throw new InternalError(`${this.constructor.name} needs at least one of the guestRoles an invitation by email gives.`);
        }
        if (options.invitationExpiresInMs != undefined && options.invitationExpiresInMs <= 0) {
            throw new InternalError(`${this.constructor.name} needs an invitationExpiresInMs above 0, or undefined.`);
        }
    }
}