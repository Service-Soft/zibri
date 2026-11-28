import { type NewTenantWebDavConnectionModel } from 'zibri-contract';

import { Property } from '../entity/decorators/property.decorator';
import { ZIBRI_WEB_DAV_CONNECTION_LIMITS } from './tenant-web-dav-connection-limits.model';
import { WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A connection of the tenant to a folder of a WebDAV server to add, as `POST /` of the
 * `TenantWebDavConnectionController` and `createConnection` of its service take it.
 */
export class NewTenantWebDavConnection implements NewTenantWebDavConnectionModel {
    /**
     * What the tenant calls it, such as `Nextcloud`, unique within the tenant.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * What server it reaches: any WebDAV server, or a Nextcloud, whose url is below `/remote.php/dav/`.
     */
    // required: a Nextcloud is reached through WebDAV as well, and which features it serves is the tenant's to say
    @Property.string({ enum: WebDavConnectionKind })
    kind!: WebDavConnectionKind;

    /**
     * The url of the folder every path is relative to, such as `https://cloud.example.com/remote.php/dav/`.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.URL_MAX_LENGTH })
    url!: string;

    /**
     * The name of the user logging in.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.USERNAME_MAX_LENGTH })
    username!: string;

    /**
     * The password of the user, such as an app password of Nextcloud.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.PASSWORD_MAX_LENGTH })
    password!: string;
}
