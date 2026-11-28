import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { Ms } from '../../../utilities/ms';
import { TenantWebDavConnection } from '../../../web-dav/tenant-web-dav-connection.model';
import { type ProjectAccess } from '../models/project-access.model';
import { ProjectCalendarDefaults } from '../models/project-calendar-defaults.model';
import { type ProjectCalendarSyncTarget } from '../models/project-calendar-sync-target.model';
import { type ProjectCalendarSync } from '../models/project-calendar-sync.model';
import { type ProjectCalendar } from '../models/project-calendar.model';
import { Project } from '../models/project.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { type WorkingCalendarChange } from '../models/working-calendar-change.model';
import { type WorkingCalendar } from '../models/working-calendar.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { type HolidayCalendarInterface } from './holiday-calendar.interface';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';
import { type WorkingCalendarServiceInterface } from './working-calendar-service.interface';

/**
 * What a calendar is without anything set: Monday to Friday, no holidays, a due date kept where it falls, and the due
 * dates written into no calendar.
 */
const DEFAULT_CALENDAR: WorkingCalendar = {
    workingWeekdays: [1, 2, 3, 4, 5],
    holidayCalendarId: null,
    nonWorkingDay: 'keep',
    calendarSync: null
};

/**
 * What a project or the tenant sets of its calendar.
 */
type CalendarValues = Pick<Project, 'workingWeekdays' | 'holidayCalendarId' | 'nonWorkingDay' | 'calendarSync'>;

/**
 * Default implementation of the working calendar service: the calendar of a project in its own columns, and the one
 * of the tenant in `ProjectCalendarDefaults`.
 */
@Injectable({ register: 'onUse' })
export class WorkingCalendarService implements WorkingCalendarServiceInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so
    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get defaultsRepository(): Repository<ProjectCalendarDefaults> {
        return inject(repositoryTokenFor(ProjectCalendarDefaults));
    }

    private get accessService(): ProjectAccessServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
    }

    private get holidayCalendar(): HolidayCalendarInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.HOLIDAY_CALENDAR);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCalendar(projectId: string): Promise<WorkingCalendar> {
        // each value on its own, from the nearest project setting it: a project below takes the holidays of the
        // customer's country from above and works on Saturdays of its own. A row seen already ends the walk, for rows
        // stored in a circle before that was refused
        const seen: string[] = [];
        const found: CalendarValues = { workingWeekdays: null, holidayCalendarId: null, nonWorkingDay: null, calendarSync: null };
        for (let currentId: string | null | undefined = projectId; currentId != undefined && !seen.includes(currentId);) {
            const project: (Pick<Project, 'id' | 'parentId'> & CalendarValues) | undefined
                = await this.projectRepository.findById(currentId, {
                    select: {
                        id: true,
                        parentId: true,
                        workingWeekdays: true,
                        holidayCalendarId: true,
                        nonWorkingDay: true,
                        calendarSync: true
                    },
                    unscoped: true,
                    required: false
                });
            if (project == undefined) {
                break;
            }
            this.fillUnset(found, project);
            seen.push(project.id);
            currentId = project.parentId;
        }
        return this.toCalendar(found, await this.findDefaults());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIsWorkingDay(calendar: WorkingCalendar, from: Date, until: Date): Promise<(day: Date) => boolean> {
        const holidays: Date[] = calendar.holidayCalendarId == undefined
            ? []
            : await this.holidayCalendar.findHolidays(calendar.holidayCalendarId, from, until) ?? [];
        const holidayTimes: Set<number> = new Set(holidays.map(day => day.getTime()));
        const weekdays: Set<number> = new Set(calendar.workingWeekdays);
        return day => weekdays.has(day.getUTCDay()) && !holidayTimes.has(day.getTime());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findProjectCalendar(projectId: string): Promise<ProjectCalendar> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        return {
            projectId: access.project.id,
            own: this.toOwn(access.project),
            effective: await this.resolveCalendar(access.project.id)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateProjectCalendar(projectId: string, change: WorkingCalendarChange): Promise<ProjectCalendar> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        await this.validateChange(change);
        const data: Partial<CalendarValues> = this.toData(change);
        if (Object.keys(data).length) {
            await this.projectRepository.updateById(access.project.id, data);
        }
        return await this.findProjectCalendar(access.project.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTenantCalendar(): Promise<ProjectCalendar> {
        const defaults: ProjectCalendarDefaults | undefined = await this.findDefaults();
        const own: CalendarValues = {
            workingWeekdays: defaults?.workingWeekdays ?? null,
            holidayCalendarId: defaults?.holidayCalendarId ?? null,
            nonWorkingDay: defaults?.nonWorkingDay ?? null,
            calendarSync: defaults?.calendarSync ?? null
        };
        return {
            projectId: null,
            own,
            effective: this.toCalendar(
                { workingWeekdays: null, holidayCalendarId: null, nonWorkingDay: null, calendarSync: null },
                defaults
            )
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateTenantCalendar(change: WorkingCalendarChange): Promise<ProjectCalendar> {
        await this.validateChange(change);
        const data: Partial<CalendarValues> = this.toData(change);
        if (Object.keys(data).length) {
            const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
            if (tenantId == undefined) {
                throw new InternalError('The calendar of a tenant is written in the tenant, and none is active.');
            }
            // one row per tenant, which two changes at once write once
            await this.defaultsRepository.upsert(
                { tenantId },
                { tenantId, workingWeekdays: null, holidayCalendarId: null, nonWorkingDay: null, calendarSync: null, ...data },
                {
                    ...data.workingWeekdays === undefined ? {} : { workingWeekdays: { set: data.workingWeekdays } },
                    ...data.holidayCalendarId === undefined ? {} : { holidayCalendarId: { set: data.holidayCalendarId } },
                    ...data.nonWorkingDay === undefined ? {} : { nonWorkingDay: { set: data.nonWorkingDay } },
                    ...data.calendarSync === undefined ? {} : { calendarSync: { set: data.calendarSync } }
                }
            );
        }
        return await this.findTenantCalendar();
    }

    /**
     * Finds the calendar of the active tenant, if it set one.
     * @returns The row.
     */
    private async findDefaults(): Promise<ProjectCalendarDefaults | undefined> {
        return await this.defaultsRepository.findOne({ required: false });
    }

    /**
     * Fills the values a project sets into those nothing below it set.
     * @param found - The values found so far.
     * @param values - What the project sets.
     */
    private fillUnset(found: CalendarValues, values: CalendarValues): void {
        found.workingWeekdays ??= values.workingWeekdays ?? null;
        found.holidayCalendarId ??= values.holidayCalendarId ?? null;
        found.nonWorkingDay ??= values.nonWorkingDay ?? null;
        // `{ target: null }` is set, and ends the search for a calendar: a project syncing into none
        found.calendarSync ??= values.calendarSync ?? null;
    }

    /**
     * Completes the values of a project with those of the tenant and those of a calendar without anything set.
     * @param found - The values of the project and the projects above it.
     * @param defaults - The calendar of the tenant, if it set one.
     * @returns The calendar.
     */
    private toCalendar(found: CalendarValues, defaults: CalendarValues | undefined): WorkingCalendar {
        return {
            workingWeekdays: found.workingWeekdays ?? defaults?.workingWeekdays ?? DEFAULT_CALENDAR.workingWeekdays,
            holidayCalendarId: found.holidayCalendarId ?? defaults?.holidayCalendarId ?? DEFAULT_CALENDAR.holidayCalendarId,
            nonWorkingDay: found.nonWorkingDay ?? defaults?.nonWorkingDay ?? DEFAULT_CALENDAR.nonWorkingDay,
            calendarSync: (found.calendarSync ?? defaults?.calendarSync)?.target ?? DEFAULT_CALENDAR.calendarSync
        };
    }

    /**
     * Gets what a project sets of its calendar, a null for each value it takes from above.
     * @param project - The project.
     * @returns The values.
     */
    private toOwn(project: Project): CalendarValues {
        return {
            workingWeekdays: project.workingWeekdays ?? null,
            holidayCalendarId: project.holidayCalendarId ?? null,
            nonWorkingDay: project.nonWorkingDay ?? null,
            calendarSync: project.calendarSync ?? null
        };
    }

    /**
     * Gets the values a change writes, leaving out those it leaves unchanged.
     * @param change - The change.
     * @returns The values.
     */
    private toData(change: WorkingCalendarChange): Partial<CalendarValues> {
        return {
            ...change.workingWeekdays === undefined
                ? {}
                : {
                    workingWeekdays: change.workingWeekdays == undefined
                        ? null
                        : [...new Set(change.workingWeekdays)].sort((a, b) => a - b)
                },
            ...change.holidayCalendarId === undefined ? {} : { holidayCalendarId: change.holidayCalendarId },
            ...change.nonWorkingDay === undefined ? {} : { nonWorkingDay: change.nonWorkingDay },
            ...change.calendarSync === undefined ? {} : { calendarSync: this.toCalendarSync(change.calendarSync) }
        };
    }

    /**
     * Gets the calendar a change sets as it is stored: its path without the slashes around it, which name the same
     * calendar.
     * @param calendarSync - What the change sets.
     * @returns It, or null to take it from above.
     */
    private toCalendarSync(calendarSync: ProjectCalendarSync | null): ProjectCalendarSync | null {
        if (calendarSync == undefined) {
            return null;
        }
        const target: ProjectCalendarSyncTarget | null | undefined = calendarSync.target;
        return {
            target: target == undefined
                ? null
                : { connectionId: target.connectionId, calendarPath: target.calendarPath.replaceAll(/^\/+|\/+$/g, '') }
        };
    }

    /**
     * Validates a change of a calendar.
     * @param change - The change.
     * @throws A BadRequestError for no working weekday, a holiday calendar the application does not know, or a calendar
     * to write the due dates into that cannot be one.
     */
    private async validateChange(change: WorkingCalendarChange): Promise<void> {
        if (change.workingWeekdays != undefined && !change.workingWeekdays.length) {
            throw new BadRequestError($ts`A working calendar needs at least one working weekday.`);
        }
        const calendarId: string | null | undefined = change.holidayCalendarId;
        if (calendarId != undefined) {
            const today: Date = new Date(Math.floor(Date.now() / Ms.DAY) * Ms.DAY);
            if (await this.holidayCalendar.findHolidays(calendarId, today, today) == undefined) {
                throw new BadRequestError($ts`The holiday calendar "${calendarId}" needs to be one your application provides.`);
            }
        }
        const target: ProjectCalendarSyncTarget | null | undefined = change.calendarSync?.target;
        if (target != undefined) {
            await this.validateCalendarSyncTarget(target);
        }
    }

    /**
     * Validates a calendar to write the due dates of tasks into.
     * @param target - The calendar.
     * @throws A BadRequestError when the application writes into no calendar, for a connection the tenant does not
     * have, or a path that is no path of a calendar.
     */
    private async validateCalendarSyncTarget(target: ProjectCalendarSyncTarget): Promise<void> {
        if (this.options.calendarSync == undefined) {
            throw new BadRequestError($ts`A calendar to write the due dates into needs the calendar sync of your application turned on.`);
        }
        const segments: string[] = target.calendarPath.replaceAll(/^\/+|\/+$/g, '').split('/');
        if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || /[\\\0]/.test(segment))) {
            throw new BadRequestError(
                $ts`The calendarPath of a calendar needs to be segments separated by "/", none of them empty, "." or "..".`
            );
        }
        const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
        if (!await connections.exists({ where: { id: target.connectionId } })) {
            throw new BadRequestError($ts`The connectionId of a calendar needs to be a WebDAV connection of the tenant.`);
        }
    }
}