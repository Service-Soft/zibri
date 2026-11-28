import { Repository } from '../data-source/repository/repository';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type TenantWebDavConnectionUsageCleanerInterface } from '../web-dav/tenant-web-dav-connection-usage-cleaner.interface';
import { type TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { CalendarEntryLink } from './calendar-entry-link.model';

/**
 * Removes the links to the entries of calendars written through a connection of a tenant once the connection is
 * deleted. The events stay in their calendars. Nothing for an application that does not declare `CalendarEntryLink`.
 */
@Injectable({ register: 'onUse' })
export class CalendarEntryLinkUsageCleaner implements TenantWebDavConnectionUsageCleanerInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeUsages(connection: TenantWebDavConnection, transaction: RepositoryTransaction): Promise<void> {
        const declared: boolean = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources()
            .some(dataSource => dataSource.entities.includes(CalendarEntryLink));
        if (!declared) {
            return;
        }
        // dropped rather than kept until the events are removed: a connection is often deleted because its server is
        // gone for good, where nothing can be removed, and its links would keep it forever
        const links: Repository<CalendarEntryLink> = inject(repositoryTokenFor(CalendarEntryLink));
        await links.deleteAll({ connectionId: connection.id }, { transaction });
    }
}
