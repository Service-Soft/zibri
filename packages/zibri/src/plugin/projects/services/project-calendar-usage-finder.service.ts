import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { inject } from '../../../di/inject.function';
import { type TranslatedString } from '../../../localization/models/translated-string.model';
import { $ts } from '../../../localization/translate.function';
import { type TenantWebDavConnectionUsageFinderInterface } from '../../../web-dav/tenant-web-dav-connection-usage-finder.interface';
import { type TenantWebDavConnection } from '../../../web-dav/tenant-web-dav-connection.model';
import { ProjectCalendarDefaults } from '../models/project-calendar-defaults.model';
import { Project } from '../models/project.model';

/**
 * Finds the working calendars of projects and of the tenant whose due dates are written into a calendar of a
 * connection, which keeps the connection from being deleted. Registered for you by `ZibriProjectsPlugin`.
 */
@Injectable({ register: 'onUse' })
export class ProjectCalendarUsageFinder implements TenantWebDavConnectionUsageFinderInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so
    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get defaultsRepository(): Repository<ProjectCalendarDefaults> {
        return inject(repositoryTokenFor(ProjectCalendarDefaults));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findUsages(connection: TenantWebDavConnection): Promise<TranslatedString[]> {
        const [projects, tenantUses] = await Promise.all([
            this.projectRepository.findAll({
                where: { calendarSync: { where: { target: { where: { connectionId: connection.id } } } } },
                select: { name: true },
                order: { name: 'ASC' },
                // every project of the tenant, whoever asks: one they do not see keeps the connection all the same
                unscoped: true,
                limit: 'all'
            }),
            this.defaultsRepository.exists({
                where: { tenantId: connection.tenantId, calendarSync: { where: { target: { where: { connectionId: connection.id } } } } }
            })
        ]);
        return [
            ...projects.length
                ? [$ts`It is the calendar of the due dates of the projects ${projects.map(project => project.name).join(', ')}.`]
                : [],
            ...tenantUses ? [$ts`It is the calendar of the due dates of every project that sets none of its own.`] : []
        ];
    }
}