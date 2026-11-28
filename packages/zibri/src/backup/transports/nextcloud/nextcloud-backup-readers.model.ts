/**
 * Who the folder of a `NextcloudBackupTransport` is shared with, to read: users and groups of the same Nextcloud.
 */
export type NextcloudBackupReaders = {
    /**
     * The ids of the users, such as `ada`. Each finds the folder among their own files, and their devices sync it.
     */
    users: string[],
    /**
     * The ids of the groups, such as `admin`, whose members each find the folder among their own files.
     */
    groups: string[]
};