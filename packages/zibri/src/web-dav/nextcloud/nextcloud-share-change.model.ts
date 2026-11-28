/**
 * A change of a share of Nextcloud.
 */
export type NextcloudShareChange = {
    /**
     * What the share lets its user or group do from now on, as Nextcloud's sum of 1 to read, 2 to change, 4 to
     * create, 8 to delete and 16 to share on: 1 for a share to read.
     */
    permissions: number
};