import { type TenantSftpTransportSecretModel } from './tenant-sftp-transport-secret.model';

/**
 * The settings of a tenant's transport of the kind `'sftp'`: where its SFTP server is, who logs in, and the key the
 * server identifies itself with. The password or the private key is a {@link TenantSftpTransportSecretModel}.
 */
export type TenantSftpTransportSettingsModel = {
    /**
     * The host of the server.
     */
    host: string,
    /**
     * The port, or absent or null for 22.
     */
    port?: number | null,
    /**
     * The user that logs in.
     */
    username: string,
    /**
     * The SHA256 fingerprint of the server's host key, as `ssh-keygen -lf` prints it, such as `SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8`.
     */
    hostKeyFingerprint: string,
    /**
     * The folder on the server the backups go into.
     */
    path: string
};