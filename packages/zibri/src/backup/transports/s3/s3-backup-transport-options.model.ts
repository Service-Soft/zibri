import { S3StorageOptions } from '../../../storage/s3-storage-options.model';

/**
 * Where and how an S3 backup transport stores backups. A backup is at most 10,000 parts, so `partSize` also decides
 * how large one can be.
 */
// the options of a bucket, which an S3 file store is configured with as well
export type S3BackupTransportOptions = S3StorageOptions;