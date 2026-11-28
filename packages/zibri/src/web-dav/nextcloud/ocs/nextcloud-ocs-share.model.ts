import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A share as the share api of Nextcloud answers it, by the names it answers with, of what a `NextcloudShare` is read
 * from.
 */
export class NextcloudOcsShare {
    /**
     * The id of the share.
     */
    @Property.string()
    id!: string;

    /**
     * Who the share is for, as Nextcloud numbers it: 0 a user, 1 a group, 3 a link.
     */
    @Property.number({ format: 'integer' })
    share_type!: number;

    /**
     * What the share lets them do, as a sum of permissions.
     */
    @Property.number({ format: 'integer' })
    permissions!: number;

    /**
     * The address of a share by link.
     */
    @Property.string({ required: false })
    url?: string | null;

    /**
     * The user or the group of a share with one.
     */
    @Property.string({ required: false })
    share_with?: string | null;

    /**
     * When the share expires, such as `2027-01-31 00:00:00`.
     */
    @Property.string({ required: false })
    expiration?: string | null;
}