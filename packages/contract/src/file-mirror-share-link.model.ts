/**
 * A link Nextcloud shares a mirrored file or folder by, to read, as the routes of the file mirror answer it. One per
 * connection and path.
 */
export type FileMirrorShareLinkModel = {
    /**
     * The id of the link.
     */
    id: string,
    /**
     * The tenant it belongs to.
     */
    tenantId: string,
    /**
     * The id of the WebDAV connection of the tenant to the Nextcloud.
     */
    connectionId: string,
    /**
     * The path the link was asked for, relative to the url of the connection.
     */
    path: string,
    /**
     * The id Nextcloud keeps the share under.
     */
    shareId: string,
    /**
     * The address anyone with it opens the file or the folder at.
     */
    url: string,
    /**
     * The day the link expires at the end of, such as `2027-01-31`, or null for one that does not.
     */
    expiresOn?: string | null,
    /**
     * When the link was created.
     */
    createdAt: Date
};
