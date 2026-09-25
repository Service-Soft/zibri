import { FileSize } from '../../../entity/models/file-property-metadata.model';

/**
 * Where and how an S3 backup transport stores backups.
 */
export interface S3BackupTransportOptions {
    /**
     * The address of the service, for example `https://s3.eu-central-1.amazonaws.com` or `http://localhost:9000`.
     */
    readonly endpoint: string,
    /**
     * The bucket the backups are stored in. It has to exist.
     */
    readonly bucket: string,
    /**
     * The region the bucket is in. A service without regions names the one it expects, usually `us-east-1` or `auto`.
     */
    readonly region: string,
    /**
     * The access key the requests are signed with.
     */
    readonly accessKeyId: string,
    /**
     * The secret of the access key.
     */
    readonly secretAccessKey: string,
    /**
     * The folder in the bucket the backups are stored in. Without one, they are stored at the top of the bucket.
     */
    readonly prefix?: string,
    /**
     * Where the bucket is named in a request: in the host name (`https://my-bucket.s3.example.com`) or in the path
     * (`https://s3.example.com/my-bucket`). Which one a service accepts depends on the service.
     */
    readonly addressingStyle: 'virtual-hosted' | 'path',
    /**
     * The size of the parts a backup is uploaded in. A backup is at most 10,000 parts, so this also decides how large
     * one can be. Between `5mb` and `5gb`, defaults to `16mb`, which allows backups of up to 156gb.
     */
    readonly partSize?: FileSize,
    /**
     * How long a single request to the service may take, in milliseconds. Defaults to five minutes.
     */
    readonly timeoutMs?: number
}