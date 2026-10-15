/**
 * How an SFTP backup transport logs in: with a password, or with a private key in OpenSSH format.
 */
export type SftpAuthentication = {
    /**
     * The password of the user.
     */
    readonly password: string
} | {
    /**
     * The private key of the user, in OpenSSH format, as it is written in its file.
     */
    readonly privateKey: string,
    /**
     * The passphrase the private key is encrypted with, if it is.
     */
    readonly passphrase?: string
};