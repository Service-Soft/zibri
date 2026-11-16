import { createHash, Hash } from 'node:crypto';

import { HttpClientBufferedBody } from '../../../http-client/http-client-buffered-body.model';

/**
 * What one request of an upload sends, with the digests it is signed and checked with.
 */
export class S3UploadBody {
    /**
     * Creates the body from its bytes and their digests.
     * @param body - The bytes.
     * @param sha256 - Their sha256, in hex, as the signature carries it.
     * @param md5 - Their md5, in base64, as `content-md5` carries it.
     */
    private constructor(readonly body: HttpClientBufferedBody, readonly sha256: string, readonly md5: string) {}

    /**
     * Builds the body from the chunks it was read in.
     *
     * The chunks are sent as they are, and the digests are taken of them one by one.
     * @param chunks - The chunks, which the body keeps.
     * @returns The body.
     */
    static fromChunks(chunks: Buffer[]): S3UploadBody {
        // a part joined into one buffer was in memory three times over while it went out, and one
        // copied into a Blob twice
        const sha256: Hash = createHash('sha256');
        const md5: Hash = createHash('md5');
        for (const chunk of chunks) {
            sha256.update(chunk);
            md5.update(chunk);
        }
        return new S3UploadBody(new HttpClientBufferedBody(chunks), sha256.digest('hex'), md5.digest('base64'));
    }
}