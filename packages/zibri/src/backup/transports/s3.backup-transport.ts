import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { XmlString } from '../../document/xml-string.type';
import { XmlUtilities } from '../../document/xml.utilities';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { HttpMethod } from '../../http/http-method.enum';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { isHttpClientError } from '../../http-client/http-client.error';
import { HttpClientInterface } from '../../http-client/http-client.interface';
import { LoggerInterface } from '../../logging/logger.interface';
import { Ms } from '../../utilities/ms';
import { BigNumber } from '../../utilities/number.utilities';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';
import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model';
import { S3CompleteMultipartUploadResult } from './s3/s3-complete-multipart-upload-result.model';
import { S3CompleteMultipartUpload } from './s3/s3-complete-multipart-upload.model';
import { S3CompletedPart } from './s3/s3-completed-part.model';
import { S3Credentials } from './s3/s3-credentials.model';
import { S3DeleteResult } from './s3/s3-delete-result.model';
import { S3Delete } from './s3/s3-delete.model';
import { S3InitiateMultipartUploadResult } from './s3/s3-initiate-multipart-upload-result.model';
import { S3ListBucketResult } from './s3/s3-list-bucket-result.model';
import { S3ServerSideEncryption } from './s3/s3-server-side-encryption.model';
import { S3SignatureUtilities } from './s3/s3-signature.utilities';
import { S3UploadBody } from './s3/s3-upload-body.model';
import { validateS3BucketName } from './s3/validate-s3-bucket-name.function';

// what the protocol allows a multipart upload: at most this many parts, each but the last at least the minimum
const MAX_PARTS: number = 10_000;
const MIN_PART_SIZE: FileSize = '5mb';
const MAX_PART_SIZE: FileSize = '5gb';
const DEFAULT_PART_SIZE: FileSize = '16mb';

const DEFAULT_TIMEOUT_MS: number = Ms.MINUTE * 5;
// a request that is answered with a 5xx or a 429 is sent again. Only the idempotent ones, which the
// http client decides by itself
const DEFAULT_ATTEMPTS: number = 3;
// a page of a listing holds up to 1,000 objects of a few hundred bytes each, and keys of up to a kilobyte.
// Well above the 100kb a body is limited to by default
const MAX_LISTING_PAGE_SIZE: FileSize = '5mb';
// the most objects one request deletes, which the protocol allows
const MAX_DELETES_PER_REQUEST: number = 1000;
// what a request deleting several is answered with: the objects it could not delete, a few hundred bytes each
const MAX_DELETE_RESULT_SIZE: FileSize = '5mb';

/**
 * A request to the service, signed and ready to send.
 */
type S3Request = {
    /**
     * Where the request goes.
     */
    url: string,
    /**
     * The headers it is sent with, the signature among them.
     */
    headers: Record<string, string>
};

/**
 * A transport that stores backups in a bucket of an S3 compatible object storage: each key an object under `prefix`.
 * An object larger than one part is uploaded in parts. Of both versions, used as `v2`.
 *
 * Backups are kept under `<prefix>/.zibri-repository/`, and backups of format 1 under `<prefix>/<backup name>/`.
 */
export class S3BackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups in the given bucket.
     * @param name - The name of the transport.
     * @param options - The bucket, how to reach and sign for it, and how objects are stored in it.
     * @param validateRedirect - What checks where a redirect the service answers with leads, before it is
     * followed, for a bucket that may not reach every host. Without it, a redirect is followed as the http
     * client follows any.
     */
    constructor(
        readonly name: string,
        private readonly options: S3BackupTransportOptions,
        private readonly validateRedirect?: (to: URL) => Promise<void>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // only where the bucket is named in the host: in the path it is encoded, and a service may take a
        // name there that no host could hold
        if (this.options.addressingStyle === 'virtual-hosted') {
            validateS3BucketName(this.name, this.options.bucket);
        }
        // every request stands on its own, so a session holds nothing open
        return await Promise.resolve(new S3BackupTransportSession(this.name, this.options, this.validateRedirect));
    }
}

/**
 * A session with the bucket: the requests, each signed on its own.
 */
class S3BackupTransportSession implements BackupTransportSessionInterface {
    constructor(
        private readonly storeName: string,
        private readonly options: S3BackupTransportOptions,
        private readonly validateRedirect: ((to: URL) => Promise<void>) | undefined
    ) {}

    private get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get keyPrefix(): string {
        return this.options.prefix == undefined ? '' : `${this.options.prefix}/`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        const objectKey: string = this.resolveObjectKey(key);
        const partSize: BigNumber = this.resolvePartSize();

        // the size is not known up front: the data is followed while it is still being written. So it
        // is buffered one part at a time, and becomes a multipart upload once there is more than one
        let chunks: Buffer[] = [];
        let buffered: number = 0;
        let uploadId: string | undefined;
        const parts: S3CompletedPart[] = [];
        try {
            for await (const chunk of data) {
                const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                chunks.push(buffer);
                buffered += buffer.length;
                if (partSize.isGreaterThan(buffered)) {
                    continue;
                }
                uploadId ??= await this.initiateMultipartUpload(objectKey);
                // the chunks handed over rather than a part built here: a suspended async function keeps
                // what a variable held at an earlier await until it is assigned again, so a part named in
                // this loop stayed in memory while the next one was gathered, two parts where one is sent
                parts.push(await this.uploadPart(objectKey, uploadId, parts.length + 1, chunks));
                chunks = [];
                buffered = 0;
            }

            if (uploadId == undefined) {
                await this.putObject(objectKey, chunks);
                return;
            }
            if (buffered > 0) {
                parts.push(await this.uploadPart(objectKey, uploadId, parts.length + 1, chunks));
            }
            await this.completeMultipartUpload(objectKey, uploadId, parts);
        }
        catch (error) {
            if (uploadId != undefined) {
                await this.abortMultipartUpload(objectKey, uploadId);
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const request: S3Request = await this.resolveRequest(HttpMethod.GET, this.resolveObjectKey(key), {}, '');
        try {
            // no larger than it may be: an object that has grown since is refused while it arrives, rather
            // than after it was written to disk in full
            return (await this.httpClient.get(request.url, {
                headers: request.headers,
                responseBody: { type: MimeType.OCTET_STREAM, maxSize: `${maxBytes}b` },
                validateRedirect: this.validateRedirect,
                timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
                attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
            })).body;
        }
        catch (error) {
            if (isHttpClientError(error) && error.responseData?.status === HttpStatus.NOT_FOUND) {
                throw new BackupKeyNotFoundError(this.storeName, key);
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        for await (const page of this.findListingPages({ prefix: `${this.keyPrefix}${prefix}` })) {
            // an object whose key ends in "/" is what a console creates as a folder, the prefix itself
            // among them: no key a store puts, which cannot end in one
            const keys: string[] = (page.contents ?? [])
                .map(o => o.key.slice(this.keyPrefix.length))
                .filter(key => key !== '' && !key.endsWith('/'));
            if (keys.length) {
                yield keys;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findNames(path: string): AsyncIterable<string[]> {
        const prefix: string = path === '' ? this.keyPrefix : `${this.resolveObjectKey(path)}/`;
        // the delimiter has the bucket list each name once, rather than every key below it
        for await (const page of this.findListingPages({ prefix, delimiter: '/' })) {
            // a key equal to the prefix is the folder a console creates as an object of its own, and
            // names nothing below it
            const names: string[] = [
                ...(page.commonPrefixes ?? []).map(p => p.prefix.slice(prefix.length, -1)),
                ...(page.contents ?? []).map(o => o.key.slice(prefix.length))
            ].filter(name => name !== '');
            if (names.length) {
                yield names;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        // up to a thousand in one request rather than one request each
        for (let i: number = 0; i < keys.length; i += MAX_DELETES_PER_REQUEST) {
            await this.deleteObjects(keys.slice(i, i + MAX_DELETES_PER_REQUEST).map(key => this.resolveObjectKey(key)));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async close(): Promise<void> {
        // nothing is held open
        return Promise.resolve();
    }

    private resolveObjectKey(key: string): string {
        // checked as the stores keeping files check it, so that a key means the same in every store
        return `${this.keyPrefix}${resolveBackupKeySegments(this.storeName, key).join('/')}`;
    }

    private async* findListingPages(listing: Record<string, string>): AsyncIterable<S3ListBucketResult> {
        let continuationToken: string | undefined;
        do {
            const query: Record<string, string> = { 'list-type': '2', ...listing };
            if (continuationToken != undefined) {
                query['continuation-token'] = continuationToken;
            }
            const request: S3Request = await this.resolveRequest(HttpMethod.GET, undefined, query, '');
            const page: S3ListBucketResult = (await this.httpClient.get(request.url, {
                headers: request.headers,
                responseBody: {
                    type: MimeType.XML,
                    modelClass: S3ListBucketResult,
                    allowAdditionalProperties: true,
                    maxSize: MAX_LISTING_PAGE_SIZE
                },
                validateRedirect: this.validateRedirect,
                timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
                attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
            })).body;
            yield page;
            continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
        } while (continuationToken != undefined);
    }

    private async deleteObjects(objectKeys: string[]): Promise<void> {
        const xml: XmlString = await XmlUtilities.generateFrom(S3Delete, { objects: objectKeys.map(key => ({ key })), quiet: true });
        // the service refuses this request without the digest of its body
        const request: S3Request = await this.resolveRequest(HttpMethod.POST, undefined, { delete: '' }, xml, {
            'content-md5': createHash('md5').update(xml)
                .digest('base64')
        });
        // a 200 for the request as a whole, naming the objects it could not delete in its body. An object
        // that is not there counts as deleted
        const result: S3DeleteResult = (await this.httpClient.post(request.url, xml, {
            headers: request.headers,
            requestBodyType: MimeType.XML,
            responseBody: {
                type: MimeType.XML,
                modelClass: S3DeleteResult,
                allowAdditionalProperties: true,
                maxSize: MAX_DELETE_RESULT_SIZE
            },
            validateRedirect: this.validateRedirect,
            timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
            attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
        })).body;
        const failed: string[] = (result.errors ?? []).map(e => {
            const message: string = e.message == undefined ? '' : `, ${e.message}`;
            return `"${e.key}": ${e.code}${message}`;
        });
        if (failed.length) {
            throw new InternalError(
                `Could not delete ${failed.length} objects from the bucket "${this.options.bucket}": ${failed.join('; ')}`
            );
        }
    }

    private async putObject(key: string, chunks: Buffer[]): Promise<void> {
        const body: S3UploadBody = S3UploadBody.fromChunks(chunks);
        const request: S3Request = await this.resolveRequest(HttpMethod.PUT, key, {}, body, {
            ...this.resolveUploadHeaders(body),
            ...this.resolveEncryptionHeaders()
        });
        await this.httpClient.put(request.url, body.body, {
            headers: request.headers,
            requestBodyType: MimeType.OCTET_STREAM,
            validateRedirect: this.validateRedirect,
            timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
            attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
        });
    }

    private async initiateMultipartUpload(key: string): Promise<string> {
        const request: S3Request = await this.resolveRequest(HttpMethod.POST, key, { uploads: '' }, '', this.resolveEncryptionHeaders());
        // the type the object is stored with is named here rather than by its parts. Without it, the service
        // stores a type of its own choosing, eg. binary/octet-stream, which the object is not read back as
        return (await this.httpClient.post(request.url, undefined, {
            headers: { ...request.headers, [KnownHeader.CONTENT_TYPE]: MimeType.OCTET_STREAM },
            responseBody: { type: MimeType.XML, modelClass: S3InitiateMultipartUploadResult, allowAdditionalProperties: true },
            validateRedirect: this.validateRedirect,
            timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS
        })).body.uploadId;
    }

    private async uploadPart(key: string, uploadId: string, partNumber: number, chunks: Buffer[]): Promise<S3CompletedPart> {
        if (partNumber > MAX_PARTS) {
            throw new InternalError(
                `"${key}" is larger than ${MAX_PARTS} parts of ${this.options.partSize ?? DEFAULT_PART_SIZE}. `
                + `Raise the partSize of the transport "${this.storeName}".`
            );
        }
        const body: S3UploadBody = S3UploadBody.fromChunks(chunks);
        const request: S3Request = await this.resolveRequest(
            HttpMethod.PUT,
            key,
            { partNumber: String(partNumber), uploadId },
            body,
            this.resolveUploadHeaders(body)
        );
        const { headers } = await this.httpClient.put(request.url, body.body, {
            headers: request.headers,
            requestBodyType: MimeType.OCTET_STREAM,
            responseHeaders: { etag: { type: 'string' } },
            validateRedirect: this.validateRedirect,
            timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
            attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
        });
        return { partNumber, eTag: headers.etag };
    }

    private async completeMultipartUpload(key: string, uploadId: string, parts: S3CompletedPart[]): Promise<void> {
        const xml: XmlString = await XmlUtilities.generateFrom(S3CompleteMultipartUpload, { parts });
        const request: S3Request = await this.resolveRequest(HttpMethod.POST, key, { uploadId }, xml);
        // the result is read even though nothing in it is needed: a service can answer this with a 200 whose
        // body is an error, and that body has no ETag
        await this.httpClient.post(request.url, xml, {
            headers: request.headers,
            requestBodyType: MimeType.XML,
            responseBody: { type: MimeType.XML, modelClass: S3CompleteMultipartUploadResult, allowAdditionalProperties: true },
            validateRedirect: this.validateRedirect,
            timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS
        });
    }

    private async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
        const request: S3Request = await this.resolveRequest(HttpMethod.DELETE, key, { uploadId }, '');
        try {
            await this.httpClient.delete(request.url, {
                headers: request.headers,
                validateRedirect: this.validateRedirect,
                timeoutInMs: this.options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
                attempts: this.options.attempts ?? DEFAULT_ATTEMPTS
            });
        }
        catch (error) {
            // logged rather than thrown, so the error that made the upload stop is the one that is reported. The
            // parts uploaded so far stay stored, and billed, until the upload is aborted
            this.logger.warn(
                `Could not abort the multipart upload "${uploadId}" of "${key}" in the bucket "${this.options.bucket}": `
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    private async resolveRequest(
        method: HttpMethod,
        key: string | undefined,
        query: Record<string, string>,
        body: S3UploadBody | string,
        headers: Record<string, string> = {}
    ): Promise<S3Request> {
        const url: URL = new URL(this.options.endpoint);
        const path: string = (key?.split('/') ?? [])
            .map(segment => S3SignatureUtilities.encode(segment))
            .join('/');
        switch (this.options.addressingStyle) {
            case 'virtual-hosted': {
                url.host = `${this.options.bucket}.${url.host}`;
                url.pathname = `/${path}`;
                break;
            }
            case 'path': {
                url.pathname = key == undefined
                    ? `/${S3SignatureUtilities.encode(this.options.bucket)}`
                    : `/${S3SignatureUtilities.encode(this.options.bucket)}/${path}`;
                break;
            }
        }
        // written out rather than through URLSearchParams, which encodes differently from what is signed
        url.search = Object.entries(query)
            .map(([name, value]) => [S3SignatureUtilities.encode(name), value === '' ? [] : [S3SignatureUtilities.encode(value)]].flat())
            .map(parameter => parameter.join('='))
            .join('&');

        // per request rather than once: credentials that expire are only good for as long as the
        // function handing them out says, and a backup of many parts outlasts a short-lived one
        const credentials: S3Credentials | (() => Promise<S3Credentials>) = this.options.credentials;
        const signed: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method,
            url,
            headers,
            payloadHash: typeof body === 'string' ? S3SignatureUtilities.hash(body) : body.sha256,
            credentials: typeof credentials === 'function' ? await credentials() : credentials,
            region: this.options.region,
            date: new Date()
        });
        return { url: url.toString(), headers: signed };
    }

    /**
     * Resolves the headers an upload of a body is sent with.
     *
     * Its digest, which the service checks what it received against, and which a bucket with object lock
     * refuses an upload without.
     * @param body - The body.
     * @returns The headers.
     */
    private resolveUploadHeaders(body: S3UploadBody): Record<string, string> {
        return { 'content-md5': body.md5 };
    }

    /**
     * Resolves the headers the request starting an object is sent with: the encryption it asks for.
     *
     * On the request that starts an object alone, a single upload or the start of one in parts: the
     * parts belong to an upload that already says how it is encrypted.
     * @returns The headers.
     */
    private resolveEncryptionHeaders(): Record<string, string> {
        const encryption: S3ServerSideEncryption = this.options.serverSideEncryption;
        if (encryption === 'bucket-default') {
            return {};
        }
        switch (encryption.algorithm) {
            case 'AES256': {
                return { 'x-amz-server-side-encryption': encryption.algorithm };
            }
            case 'aws:kms': {
                return {
                    'x-amz-server-side-encryption': encryption.algorithm,
                    ...encryption.keyId == undefined ? {} : { 'x-amz-server-side-encryption-aws-kms-key-id': encryption.keyId }
                };
            }
        }
    }

    private resolvePartSize(): BigNumber {
        const partSize: BigNumber = fileSizeToBytes(this.options.partSize ?? DEFAULT_PART_SIZE);
        if (partSize.isLessThan(fileSizeToBytes(MIN_PART_SIZE)) || partSize.isGreaterThan(fileSizeToBytes(MAX_PART_SIZE))) {
            throw new InternalError(
                `The partSize of the transport "${this.storeName}" has to be between ${MIN_PART_SIZE} and ${MAX_PART_SIZE}.`
            );
        }
        return partSize;
    }
}