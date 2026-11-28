import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';
import { type TenantWebDavConnectionUsageFinderInterface } from '../../web-dav/tenant-web-dav-connection-usage-finder.interface';
import { type TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { TenantBackupTransport } from './tenant-backup-transport.model';

/**
 * Finds the transports a tenant keeps its backups through a WebDAV connection with, which keep the connection from
 * being deleted. Nothing for an application that does not declare `TenantBackupTransport`.
 */
@Injectable({ register: 'onUse' })
export class WebDavBackupTransportUsageFinder implements TenantWebDavConnectionUsageFinderInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findUsages(connection: TenantWebDavConnection): Promise<TranslatedString[]> {
        const declared: boolean = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources()
            .some(dataSource => dataSource.entities.includes(TenantBackupTransport));
        if (!declared) {
            return [];
        }
        const transports: TenantBackupTransport[] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            connection.tenantId,
            async () => await inject(repositoryTokenFor(TenantBackupTransport)).findAll({ order: { name: 'ASC' }, limit: 'all' })
        );
        // of any kind naming it rather than of the kinds the application lists now: a transport of a kind taken out of
        // the options still holds backups, which a connection deleted would make unreachable for good
        const names: string[] = transports
            .filter(transport => transport.settings['connectionId'] === connection.id)
            .map(transport => transport.name);
        return names.length ? [$ts`Backups are kept through it by the transports ${names.join(', ')}.`] : [];
    }
}