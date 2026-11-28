/**
 * How a file or a folder is moved on a WebDAV server.
 */
export type WebDavMoveOptions = {
    /**
     * Whether what is at the destination is replaced. Without, a move to a destination that exists fails with a
     * `WebDavPreconditionFailedError`.
     */
    // required: WebDAV replaces by default, and a mirror or a backup has to say which of the two it means
    overwrite: boolean
};