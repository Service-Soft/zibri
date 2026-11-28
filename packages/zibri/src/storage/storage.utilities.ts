import { InternalError } from '../error-handling/internal-error.model';

// what any bucket name is made of, the ones of the rules AWS had before its current ones included. A bucket
// is named in the host of a request too, so anything else in one, such as ":" or "/", would lead the
// request to another host or port than the endpoint's
const BUCKET_NAME_PATTERN: RegExp = /^[\w.-]+$/;

/**
 * The checks every store keeping blobs under keys shares, a backup transport's and a file store's alike.
 */
export abstract class StorageUtilities {
    /**
     * Resolves the segments of a key, for a store that keeps what its keys hold as files.
     * @param subject - The store as the error names it, such as `backup transport "nightly"`.
     * @param key - The key.
     * @returns Its `/`-separated segments.
     * @throws When a segment is empty, `.` or `..`, or holds a backslash or a null character, any of which
     * could lead the file outside the store's folder.
     */
    static resolveKeySegments(subject: string, key: string): string[] {
        const segments: string[] = key.split('/');
        if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || /[\\\0]/.test(segment))) {
            throw new InternalError(
                `The key "${key}" of the ${subject} needs to be segments separated by "/", `
                + 'none of them empty, "." or "..".'
            );
        }
        return segments;
    }

    /**
     * Validates the name of a bucket: letters, digits, `.`, `-` and `_`, which is what every bucket name is made of.
     * @param subject - The store as the error names it, such as `backup transport "nightly"`.
     * @param bucket - The bucket.
     * @throws When it holds anything else.
     */
    static validateBucketName(subject: string, bucket: string): void {
        if (!BUCKET_NAME_PATTERN.test(bucket)) {
            throw new InternalError(
                `The bucket of the ${subject} needs to be letters, digits, ".", "-" and "_", and is "${bucket}".`
            );
        }
    }
}