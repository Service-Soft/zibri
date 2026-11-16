import { SftpAuthentication } from './sftp-authentication.model';

/**
 * Where and how an SFTP backup transport stores backups.
 */
export interface SftpBackupTransportOptions {
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
     * The folder on the server the backups are stored in. It is created when it does not exist.
     */
    readonly path: string,
    /**
     * How long connecting and logging in may take, and opening the SFTP session after, in milliseconds. Defaults to
     * 20 seconds each.
     */
    readonly connectTimeoutInMs?: number,
    /**
     * How long the server may answer nothing while the transport waits for an answer, in milliseconds. A transfer
     * takes as long as it needs while the server keeps answering. When it answers nothing for this long, the
     * connection is ended, and whatever waited on it fails with an error naming what it waited for. Defaults to 60
     * seconds.
     */
    readonly requestTimeoutInMs?: number
}