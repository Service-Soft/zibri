/**
 * A share by link: anyone with the link reads the file or the folder, and changes nothing.
 */
type NewNextcloudLinkShare = {
    /**
     * `'link'`: anyone with the link reads the file or the folder, and changes nothing.
     */
    type: 'link',
    /**
     * The path of the file or the folder, relative to the url of the connection. It is among the files of the user
     * of the connection.
     */
    path: string,
    /**
     * The password the link asks for, or undefined for a link that opens without one. Nextcloud refuses one its
     * password policy refuses, and a link without one where its settings ask for a password.
     */
    password: string | undefined,
    /**
     * The day the link expires at the end of, such as `2027-01-31`, or undefined for one that does not. Nextcloud
     * refuses one past the latest day its settings allow.
     */
    expiresOn: string | undefined
};

/**
 * A share with a user or a group of the same Nextcloud, which then finds the file or the folder among their own.
 */
type NewNextcloudRecipientShare = {
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

/**
 * A share of a file or a folder to create on Nextcloud: a link anyone who has it reads the file or the folder with,
 * or a share with a user or a group of the same Nextcloud.
 */
export type NewNextcloudShare = NewNextcloudLinkShare | NewNextcloudRecipientShare;
