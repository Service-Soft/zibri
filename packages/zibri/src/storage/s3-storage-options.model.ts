import { S3Credentials } from '../backup/transports/s3/s3-credentials.model';
import { S3ServerSideEncryption } from '../backup/transports/s3/s3-server-side-encryption.model';
import { FileSize } from '../entity/models/file-property-metadata.model';

/**
 * Where a bucket of an S3 compatible object storage is, how its requests are signed, and how objects are stored in it:
 * what an S3 backup transport and an S3 file store are both configured with.
 */
export interface S3StorageOptions {
    /**
     * The address of the service, for example `https://s3.eu-central-1.amazonaws.com` or `http://localhost:9000`.
     */
    readonly endpoint: string,
    /**
     * The bucket the objects are stored in. It has to exist.
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
     * How the service encrypts the objects it stores: as the bucket's default encryption says, or with
     * the algorithm and key every object is uploaded with.
     */
    readonly serverSideEncryption: S3ServerSideEncryption,
    /**
     * The folder in the bucket the objects are stored in. Without one, they are stored at the top of the bucket.
     */
    readonly prefix?: string,
    /**
     * Where the bucket is named in a request: in the host name (`https://my-bucket.s3.example.com`) or in the path
     * (`https://s3.example.com/my-bucket`). Which one a service accepts depends on the service.
     */
    readonly addressingStyle: 'virtual-hosted' | 'path',
    /**
     * The size of the parts an object is uploaded in. An object is at most 10,000 parts, so this also decides how
     * large one can be. Between `5mb` and `5gb`, defaults to `16mb`, which allows objects of up to 156gb.
     */
    readonly partSize?: FileSize,
    /**
     * How long a single request to the service may take, in milliseconds. Defaults to five minutes.
     */
    readonly timeoutInMs?: number,
    /**
     * How many times a request the service answers with a server error or `429` is sent, the first
     * one included. Only a request that can be sent again without changing its outcome is. Defaults to 3.
     */
    readonly attempts?: number
}