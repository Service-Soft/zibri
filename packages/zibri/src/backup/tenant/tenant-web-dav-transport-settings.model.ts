import { type TenantWebDavTransportSettingsModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * Which WebDAV connection of a tenant its backups are kept through, and the folder below it. The password is the
 * connection's, stored encrypted with it.
 */
export class TenantWebDavTransportSettings implements TenantWebDavTransportSettingsModel {
    /**
     * The id of the `TenantWebDavConnection` of the tenant, of the kind `WEB_DAV`.
     */
    @Property.string()
    connectionId!: string;

    /**
     * The folder the backups are kept in, relative to the url of the connection, such as `Backups`, or `''` for the
     * folder of the connection itself.
     */
    @Property.string()
    folder!: string;
}
