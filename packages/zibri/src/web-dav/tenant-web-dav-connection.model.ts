import { type TenantWebDavConnectionModel } from 'zibri-contract';

import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * A folder of a WebDAV server a tenant configured, such as its Nextcloud, and who logs in to it. Its password is
 * stored encrypted. A client of it is created with `WebDavClient.createForTenant`, or `NextcloudClient.createForTenant`
 * for a Nextcloud, which check its hosts. Tenants manage theirs through the routes of a
 * `TenantWebDavConnectionController`.
 */
// declared only by an application whose tenants configure servers of their own
@Entity({ uniques: [['name']], allowOrphan: true })
export class TenantWebDavConnection extends BaseTenantEntity() implements TenantWebDavConnectionModel {
    /**
     * What the tenant calls it, unique within the tenant.
     */
    @Property.string()
    name!: string;

    /**
     * What server it reaches: any WebDAV server, or a Nextcloud.
     */
    @Property.string({ enum: WebDavConnectionKind })
    kind!: WebDavConnectionKind;

    /**
     * The url of the folder every path is relative to.
     */
    @Property.string()
    url!: string;

    /**
     * The name of the user logging in.
     */
    @Property.string()
    username!: string;

    /**
     * The password of the user, such as an app password of Nextcloud. Encrypted, and left out wherever the row is
     * serialized.
     */
    @Property.string({ encryption: true, exclude: true })
    password!: string;
}