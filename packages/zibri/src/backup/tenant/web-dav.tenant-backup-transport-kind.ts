import { ZIBRI_BACKUP_TRANSPORT_KINDS } from 'zibri-contract';

import { Newable } from '../../types/newable.type';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../../web-dav/web-dav-connection-kind.enum';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';
import { WebDavBackupTransport } from '../transports/web-dav.backup-transport';
import { TenantBackupTransportKindInterface } from './tenant-backup-transport-kind.interface';
import { TenantTransportNetwork } from './tenant-transport-network.model';
import { TenantWebDavTransportSecret } from './tenant-web-dav-transport-secret.model';
import { TenantWebDavTransportSettings } from './tenant-web-dav-transport-settings.model';
import { TenantWebDavTransportUtilities } from './tenant-web-dav-transport.utilities';

/**
 * A folder of a WebDAV server a tenant keeps its backups in, reached through a `TenantWebDavConnection` of the tenant
 * of the kind `WEB_DAV`, whose password it logs in with.
 *
 * The host of the connection, and of every redirect, is checked against what `BACKUP_TENANT_TRANSPORT_OPTIONS` lets
 * tenants reach, before every session. A connection a transport is kept through is not deleted.
 */
export class WebDavTenantBackupTransportKind
implements TenantBackupTransportKindInterface<TenantWebDavTransportSettings, TenantWebDavTransportSecret> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = ZIBRI_BACKUP_TRANSPORT_KINDS.WEB_DAV;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly settingsModel: Newable<TenantWebDavTransportSettings> = TenantWebDavTransportSettings;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secretModel: Newable<TenantWebDavTransportSecret> = TenantWebDavTransportSecret;

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateSettings(settings: TenantWebDavTransportSettings): void {
        TenantWebDavTransportUtilities.validateFolder(settings.folder);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTransport(
        name: string,
        settings: TenantWebDavTransportSettings,
        _: TenantWebDavTransportSecret,
        network: TenantTransportNetwork,
        tenantId: string
    ): Promise<BackupTransportSupporting<'v2'>> {
        // read for every session, so that a password changed on the connection is the one logged in with
        const connection: TenantWebDavConnection = await TenantWebDavTransportUtilities.resolveConnection(
            name,
            tenantId,
            settings.connectionId,
            WebDavConnectionKind.WEB_DAV
        );
        return new WebDavBackupTransport(name, {
            connection: { url: connection.url, username: connection.username, password: connection.password },
            folder: settings.folder,
            network
        });
    }
}
