/**
 * The secret of a tenant's transport of the kind `'sftp'`: a password, or a private key in OpenSSH format, exactly one
 * of them.
 */
export type TenantSftpTransportSecretModel = {
    /**
     * The password of the user.
     */
    password?: string,
    /**
     * The private key of the user, in OpenSSH format, as it is written in its file.
     */
    privateKey?: string,
    /**
     * The passphrase the private key is encrypted with, if it is.
     */
    passphrase?: string
};
