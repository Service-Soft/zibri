import { Readable } from 'node:stream';

import { S3StorageOptions } from '../../storage/s3-storage-options.model';
import { S3StorageSession } from '../../storage/s3.storage-session';
import { StorageNaming } from '../../storage/storage-naming.model';
import { StorageUtilities } from '../../storage/storage.utilities';
import { FileStoreEntry } from './file-store-entry.model';
import { FileStoreInterface } from './file-store.interface';
import { resolveFileStorageNaming } from './resolve-file-storage-naming.function';

/**
 * A file store that keeps the bytes in a bucket of an S3 compatible object storage: each key an object under
 * `prefix`. An object larger than one part is uploaded in parts.
 */
export class S3FileStore implements FileStoreInterface {
    // a bucket is kept the same way a backup transport keeps one, so the session is the one both stand on. Every
    // request is signed on its own, so one serves every call
    private readonly session: S3StorageSession;

    /**
     * Creates the store keeping the bytes in the given bucket.
     * @param name - The name of the store.
     * @param options - The bucket, how to reach and sign for it, and how objects are stored in it.
     * @param validateRedirect - What checks where a redirect the service answers with leads, before it is followed,
     * for a bucket that may not reach every host. Without it, a redirect is followed as the http client follows any.
     */
    constructor(readonly name: string, options: S3StorageOptions, validateRedirect?: (to: URL) => Promise<void>) {
        const naming: StorageNaming = resolveFileStorageNaming(name);
        // only where the bucket is named in the host: in the path it is encoded, and a service may take a name there
        // that no host could hold
        if (options.addressingStyle === 'virtual-hosted') {
            StorageUtilities.validateBucketName(naming.subject, options.bucket);
        }
        this.session = new S3StorageSession(naming, options, validateRedirect);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        await this.session.put(key, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        return await this.session.get(key, maxBytes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(key: string): Promise<FileStoreEntry | undefined> {
        return await this.session.findEntry(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findKeys(prefix: string): AsyncIterable<string[]> {
        return this.session.findKeys(prefix);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await this.session.delete(keys);
    }
}