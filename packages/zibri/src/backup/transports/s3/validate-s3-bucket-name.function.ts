import { InternalError } from '../../../error-handling/internal-error.model';

// what any bucket name is made of, the ones of the rules AWS had before its current ones included. A bucket
// is named in the host of a request too, so anything else in one, such as ":" or "/", would lead the
// request to another host or port than the endpoint's
const BUCKET_NAME_PATTERN: RegExp = /^[\w.-]+$/;

/**
 * Validates the name of a bucket: letters, digits, `.`, `-` and `_`, which is what every bucket name is
 * made of.
 * @param storeName - The name of the store, for the error.
 * @param bucket - The bucket.
 * @throws When it holds anything else.
 */
export function validateS3BucketName(storeName: string, bucket: string): void {
    if (!BUCKET_NAME_PATTERN.test(bucket)) {
        throw new InternalError(
            `The bucket of the backup transport "${storeName}" needs to be letters, digits, ".", "-" and "_", and is "${bucket}".`
        );
    }
}