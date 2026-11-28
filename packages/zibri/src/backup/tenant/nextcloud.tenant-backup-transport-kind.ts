import { ZIBRI_BACKUP_TRANSPORT_KINDS } from 'zibri-contract';

import { Newable } from '../../types/newable.type';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../../web-dav/web-dav-connection-kind.enum';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';
import { NextcloudBackupTransport } from '../transports/nextcloud.backup-transport';
import { TenantBackupTransportKindInterface } from './tenant-backup-transport-kind.interface';
import { TenantNextcloudTransportSettings } from './tenant-nextcloud-transport-settings.model';
import { TenantTransportNetwork } from './tenant-transport-network.model';
import { TenantWebDavTransportSecret } from './tenant-web-dav-transport-secret.model';
import { TenantWebDavTransportUtilities } from './tenant-web-dav-transport.utilities';

/**
 * A folder of a Nextcloud a tenant keeps its backups in, as a `NextcloudBackupTransport` keeps them: reached through a
 * `TenantWebDavConnection` of the tenant of the kind `NEXTCLOUD`, logged in as the user owning the folder, and shared
 * with the users and groups the settings name, to read.
 *
 * The host of the connection, and of every redirect, is checked against what `BACKUP_TENANT_TRANSPORT_OPTIONS` lets
 * tenants reach, before every session. A connection a transport is kept through is not deleted.
 */
export class NextcloudTenantBackupTransportKind
implements TenantBackupTransportKindInterface<TenantNextcloudTransportSettings, TenantWebDavTransportSecret> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = ZIBRI_BACKUP_TRANSPORT_KINDS.NEXTCLOUD;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly settingsModel: Newable<TenantNextcloudTransportSettings> = TenantNextcloudTransportSettings;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secretModel: Newable<TenantWebDavTransportSecret> = TenantWebDavTransportSecret;

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateSettings(settings: TenantNextcloudTransportSettings): void {
        TenantWebDavTransportUtilities.validateFolder(settings.folder);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTransport(
        name: string,
        settings: TenantNextcloudTransportSettings,
        _: TenantWebDavTransportSecret,
        network: TenantTransportNetwork,
        tenantId: string
    ): Promise<BackupTransportSupporting<'v2'>> {
        // read for every session, so that a password changed on the connection is the one logged in with
        const connection: TenantWebDavConnection = await TenantWebDavTransportUtilities.resolveConnection(
            name,
            tenantId,
            settings.connectionId,
            WebDavConnectionKind.NEXTCLOUD
        );
        return new NextcloudBackupTransport(name, {
            connection: { url: connection.url, username: connection.username, password: connection.password },
            folder: settings.folder,
            network,
            sharedWith: { users: settings.sharedWithUsers, groups: settings.sharedWithGroups }
        });
    }
}
