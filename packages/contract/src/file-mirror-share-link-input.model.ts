/**
 * What a share link of a mirrored file or folder is asked for with, as `POST /share-links` of the routes of the file
 * mirror takes it. The link created for the path before is answered while Nextcloud still has it, and a new one is
 * created otherwise.
 */
export type FileMirrorShareLinkInputModel = {
    /**
     * The id of the WebDAV connection of the tenant to the Nextcloud, of the kind `NEXTCLOUD`.
     */
    connectionId: string,
    /**
     * The path of the file or the folder, relative to the url of the connection, such as `Customers/Ada Lovelace`.
     * For a mirrored file, the path it was mirrored to, which finds it where somebody moved it.
     */
    path: string,
    /**
     * The password the link asks for. A link without one opens for anyone who has it. Applies to a link created.
     */
    password?: string,
    /**
     * The day the link expires at the end of, such as `2027-01-31`. A link without one does not expire. Applies to a
     * link created.
     */
    expiresOn?: string
};
