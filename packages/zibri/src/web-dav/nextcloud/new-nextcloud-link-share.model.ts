/**
 * A share by link: anyone with the link reads the file or the folder, and changes nothing.
 */
export type NewNextcloudLinkShare = {
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