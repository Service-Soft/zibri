import { type FileMirrorShareLinkModel } from 'zibri-contract';

import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

/**
 * A link Nextcloud shares a mirrored file or folder by, to read: its url, and the share it is, so that the next ask
 * for a link of the same path answers this one. One per connection and path.
 */
// declared only by an application that asks for share links
@Entity({ allowOrphan: true, uniques: [['connectionId', 'path']] })
export class FileMirrorShareLink extends BaseTenantEntity() implements FileMirrorShareLinkModel {
    /**
     * The id of the `TenantWebDavConnection` of the Nextcloud.
     */
    @Property.string({ format: 'uuid' })
    connectionId!: string;

    /**
     * The path the link was asked for, relative to the url of the connection.
     */
    @Property.string({ maxLength: 1500 })
    path!: string;

    /**
     * The id Nextcloud keeps the share under.
     */
    @Property.string({ maxLength: 100 })
    shareId!: string;

    /**
     * The address anyone with it opens the file or the folder at.
     */
    @Property.string({ maxLength: 2000 })
    url!: string;

    /**
     * The day the link expires at the end of, such as `2027-01-31`, or null for one that does not.
     */
    @Property.string({ maxLength: 10, required: false })
    expiresOn?: string | null;

    /**
     * When the link was created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
}
