/**
 * What a share link of a mirrored file or folder is asked for with, as `resolveShareLink` of the file mirror service
 * takes it.
 */
export type FileMirrorShareLinkOptions = {
    /**
     * The id of the `TenantWebDavConnection` of the active tenant, of the kind `NEXTCLOUD`.
     */
    connectionId: string,
    /**
     * The path of the file or the folder, relative to the url of the connection, such as `Customers/Ada Lovelace`.
     * For a mirrored file, the path it was mirrored to, which finds it where somebody moved it.
     */
    path: string,
    /**
     * The password the link asks for, or undefined for a link that opens without one. Applies to a link created by
     * the call.
     */
    password: string | undefined,
    /**
     * The day the link expires at the end of, such as `2027-01-31`, or undefined for one that does not. Applies to a
     * link created by the call.
     */
    expiresOn: string | undefined
};
