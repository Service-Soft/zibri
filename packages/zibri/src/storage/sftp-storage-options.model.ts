import { SftpAuthentication } from '../backup/transports/sftp/sftp-authentication.model';

/**
 * Where an SFTP server is, how to log in to it, and the folder on it the blobs are kept in: what an SFTP backup
 * transport and an SFTP file store are both configured with.
 */
export interface SftpStorageOptions {
    /**
     * The host name or address of the server.
     */
    readonly host: string,
    /**
     * The port the server listens on. Defaults to 22.
     */
    readonly port?: number,
    /**
     * The user to log in as.
     */
    readonly username: string,
    /**
     * How the user logs in.
     */
    readonly authentication: SftpAuthentication,
    /**
     * The fingerprint of the key the server identifies itself with, as `ssh-keygen -lf` prints it, for example
     * `SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s`. A server presenting any other key is refused.
     */
    readonly hostKeyFingerprint: string,
    /**
     * The folder on the server the blobs are stored in. It is created when it does not exist.
     */
    readonly path: string,
    /**
     * How long connecting and logging in may take, and opening the SFTP session after, in milliseconds. Defaults to
     * 20 seconds each.
     */
    readonly connectTimeoutInMs?: number,
    /**
     * How long the server may answer nothing while the store waits for an answer, in milliseconds. A transfer
     * takes as long as it needs while the server keeps answering. When it answers nothing for this long, the
     * connection is ended, and whatever waited on it fails with an error naming what it waited for. Defaults to 60
     * seconds.
     */
    readonly requestTimeoutInMs?: number
}