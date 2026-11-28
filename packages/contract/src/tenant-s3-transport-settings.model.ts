import { type TenantS3TransportSecretModel } from './tenant-s3-transport-secret.model';

/**
 * Where the requests to a bucket name it: in the host, as `acme-backups.s3.example.com`, or in the path, as
 * `s3.example.com/acme-backups`.
 */
// eslint-disable-next-line typescript/typedef
export const S3_ADDRESSING_STYLES = ['virtual-hosted', 'path'] as const;

/**
 * One of {@link S3_ADDRESSING_STYLES}.
 */
export type S3AddressingStyle = typeof S3_ADDRESSING_STYLES[number];

/**
 * The settings of a tenant's transport of the kind `'s3'`: where its bucket is, and the id of the key it is reached
 * with. The secret of the key is a {@link TenantS3TransportSecretModel}.
 */
export type TenantS3TransportSettingsModel = {
    /**
     * The address of the storage, over https, such as `https://s3.eu-central-1.amazonaws.com`.
     */
    endpoint: string,
    /**
     * The bucket.
     */
    bucket: string,
    /**
     * The region of the bucket, such as `eu-central-1`.
     */
    region: string,
    /**
     * The id of the access key.
     */
    accessKeyId: string,
    /**
     * The folder in the bucket the backups go under, or absent or null for its top.
     */
    prefix?: string | null,
    /**
     * Whether the bucket is named in the host or in the path of each request.
     */
    addressingStyle: S3AddressingStyle
};