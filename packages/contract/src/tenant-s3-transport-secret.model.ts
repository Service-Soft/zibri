/**
 * The secret of a tenant's transport of the kind `'s3'`: the secret of its access key.
 */
export type TenantS3TransportSecretModel = {
    /**
     * The secret of the access key.
     */
    secretAccessKey: string
};