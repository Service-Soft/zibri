/**
 * What server a WebDAV connection of a tenant reaches, which decides what beside WebDAV it is used for.
 */
export enum WebDavConnectionKind {
    /**
     * Any WebDAV server, reached through WebDAV alone.
     */
    WEB_DAV = 'WEB_DAV',
    /**
     * A Nextcloud, whose url is below `/remote.php/dav/`: a file mirrored through it is found again after it is
     * moved, and it creates share links.
     */
    NEXTCLOUD = 'NEXTCLOUD'
}