import { type TenantNextcloudTransportSettingsModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * Which Nextcloud connection of a tenant its backups are kept through, the folder below it, and who the folder is
 * shared with to read. The password is the connection's, stored encrypted with it.
 */
export class TenantNextcloudTransportSettings implements TenantNextcloudTransportSettingsModel {
    /**
     * The id of the `TenantWebDavConnection` of the tenant, of the kind `NEXTCLOUD`, logged in as the user owning the
     * folder.
     */
    @Property.string()
    connectionId!: string;

    /**
     * The folder the backups are kept in, relative to the url of the connection, such as `Backups`.
     */
    @Property.string()
    folder!: string;

    /**
     * The ids of the users of the Nextcloud the folder is shared with, to read. Required, empty for none.
     */
    @Property.array({ items: { type: 'string' } })
    sharedWithUsers!: string[];

    /**
     * The ids of the groups of the Nextcloud the folder is shared with, to read. Required, empty for none.
     */
    @Property.array({ items: { type: 'string' } })
    sharedWithGroups!: string[];
}