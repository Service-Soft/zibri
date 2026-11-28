import { type TenantWebDavConnectionChangeModel } from 'zibri-contract';

import { Property } from '../entity/decorators/property.decorator';
import { ZIBRI_WEB_DAV_CONNECTION_LIMITS } from './tenant-web-dav-connection-limits.model';
import { WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A change of a connection of the tenant to a folder of a WebDAV server, as `PATCH /:connectionId` of the
 * `TenantWebDavConnectionController` and `updateConnection` of its service take it. Each property is unchanged when
 * absent.
 */
export class TenantWebDavConnectionChange implements TenantWebDavConnectionChangeModel {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.NAME_MAX_LENGTH, required: false })
    name?: string;

    /**
     * What server it reaches.
     */
    @Property.string({ enum: WebDavConnectionKind, required: false })
    kind?: WebDavConnectionKind;

    /**
     * The url of the folder every path is relative to.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.URL_MAX_LENGTH, required: false })
    url?: string;

    /**
     * The name of the user logging in.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.USERNAME_MAX_LENGTH, required: false })
    username?: string;

    /**
     * The password of the user.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_WEB_DAV_CONNECTION_LIMITS.PASSWORD_MAX_LENGTH, required: false })
    password?: string;
}