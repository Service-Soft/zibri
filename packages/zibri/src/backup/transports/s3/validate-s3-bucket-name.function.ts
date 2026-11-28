import { StorageUtilities } from '../../../storage/storage.utilities';

/**
 * Validates the name of a bucket: letters, digits, `.`, `-` and `_`, which is what every bucket name is
 * made of.
 * @param storeName - The name of the store, for the error.
 * @param bucket - The bucket.
 * @throws When it holds anything else.
 */
export function validateS3BucketName(storeName: string, bucket: string): void {
    StorageUtilities.validateBucketName(`backup transport "${storeName}"`, bucket);
}