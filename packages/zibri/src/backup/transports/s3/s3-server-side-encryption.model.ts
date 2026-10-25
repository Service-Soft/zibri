/**
 * How the service encrypts the backups it stores.
 *
 * `'bucket-default'` leaves it to the default encryption of the bucket. Otherwise every backup is
 * uploaded asking for the given algorithm: `AES256` for keys the service manages, `aws:kms` for a key
 * of its key management service, the bucket's or the one named by `keyId`.
 */
export type S3ServerSideEncryption
    = | 'bucket-default'
        | {
            /**
             * Keys the service manages.
             */
            readonly algorithm: 'AES256'
        }
        | {
            /**
             * A key of the service's key management service.
             */
            readonly algorithm: 'aws:kms',
            /**
             * The key. Without one, the service uses its default key.
             */
            readonly keyId?: string
        };