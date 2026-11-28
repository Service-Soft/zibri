/**
 * A share with a user or a group of the same Nextcloud, which then finds the file or the folder among their own.
 */
export type NewNextcloudRecipientShare = {
    /**
     * `'user'` for a share with one user, `'group'` for one with every member of a group.
     */
    type: 'user' | 'group',
    /**
     * The path of the file or the folder, relative to the url of the connection. It is among the files of the user
     * of the connection.
     */
    path: string,
    /**
     * The id of the user or the group, such as `ada` or `accounting`.
     */
    shareWith: string,
    /**
     * What the share lets them do, as Nextcloud's sum of 1 to read, 2 to change, 4 to create, 8 to delete and 16 to
     * share on: 1 for a share to read.
     */
    // required: Nextcloud gives a share with a user every permission when none is named, and a share to read is as
    // legitimate an answer
    permissions: number
};