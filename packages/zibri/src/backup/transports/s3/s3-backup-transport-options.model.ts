import { S3Credentials } from './s3-credentials.model';
import { S3ServerSideEncryption } from './s3-server-side-encryption.model';
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
     * What the requests are signed with: an access key and its secret, or a function resolving the
     * credentials before every request, for credentials that expire. Such a function returns the same
     * credentials for as long as they are valid.
     */
    readonly credentials: S3Credentials | (() => Promise<S3Credentials>),
    /**
     * How the service encrypts the backups it stores: as the bucket's default encryption says, or with
     * the algorithm and key every backup is uploaded with.
     */
    readonly serverSideEncryption: S3ServerSideEncryption,
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