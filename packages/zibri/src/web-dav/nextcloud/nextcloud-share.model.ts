import { type NextcloudShareType } from './nextcloud-share-type.model';

/**
 * A share of a file or a folder on Nextcloud, as its share api answers it.
 */
export type NextcloudShare = {
    /**
     * The id Nextcloud keeps the share under.
     */
    id: string,
    /**
     * Who the share gives the file or the folder to.
     */
    type: NextcloudShareType,
    /**
     * What it lets them do, as Nextcloud's sum of 1 to read, 2 to change, 4 to create, 8 to delete and 16 to share
     * on: 1 for a share to read, and 17 for a link to read, as Nextcloud lets anyone with a link pass it on.
     */
    permissions: number,
    /**
     * The address anyone with it opens the file or the folder at, for a share by link, or undefined for any other.
     */
    url: string | undefined,
    /**
     * The user or the group a share gives the file or the folder to, or undefined for a share by link.
     */
    shareWith: string | undefined,
    /**
     * The day the share expires at the end of, such as `2027-01-31`, or undefined for one that does not expire.
     */
    expiresOn: string | undefined
};