import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { BackupTransportInterface } from './backup-transport.interface.ts';
import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model.ts';
import { S3CompleteMultipartUploadResult } from './s3/s3-complete-multipart-upload-result.model.ts';
import { S3CompleteMultipartUpload } from './s3/s3-complete-multipart-upload.model.ts';
import { S3CompletedPart } from './s3/s3-completed-part.model.ts';
import { S3InitiateMultipartUploadResult } from './s3/s3-initiate-multipart-upload-result.model.ts';
import { S3ListBucketResult } from './s3/s3-list-bucket-result.model.ts';
import { S3SignatureUtilities } from './s3/s3-signature.utilities.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { XmlString } from '../../document/xml-string.type.ts';
import { XmlUtilities } from '../../document/xml.utilities.ts';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { HttpMethod } from '../../http/http-method.enum.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientInterface } from '../../http-client/http-client.interface.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';
import { BackupEntity } from '../backup-entity.model.ts';
import { BackupResourceEntity } from '../backup-resource-entity.model.ts';

const METADATA_FILENAME: string = 'metadata.json';

// what the protocol allows a multipart upload: at most this many parts, each but the last at least the minimum
const MAX_PARTS: number = 10_000;
const MIN_PART_SIZE: FileSize = '5mb';
const MAX_PART_SIZE: FileSize = '5gb';
const DEFAULT_PART_SIZE: FileSize = '16mb';

const DEFAULT_TIMEOUT_MS: number = Ms.MINUTE * 5;
// a request that is answered with a 5xx or a 429 is sent again. Only the idempotent ones, which the
// http client decides by itself
const ATTEMPTS: number = 3;
// the record of a backup names it and its resources, which is far below this
const MAX_METADATA_SIZE: FileSize = '10mb';
// a page of a listing holds up to 1,000 objects of a few hundred bytes each, and keys of up to a kilobyte.
// Well above the 100kb a body is limited to by default
const MAX_LISTING_PAGE_SIZE: FileSize = '5mb';

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
 * A transport that stores backups in a bucket of an S3 compatible object storage.
 *
 * Each resource is stored as the object `<prefix>/<backup name>/<resource name>`, and the record of the backup as
 * `<prefix>/<backup name>/metadata.json` beside it. A resource larger than one part is uploaded in parts.
 */
export abstract class BaseS3BackupTransport implements BackupTransportInterface {
    abstract readonly name: string;
    protected abstract readonly options: S3BackupTransportOptions;

    private get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get keyPrefix(): string {
        return this.options.prefix == undefined ? '' : `${this.options.prefix}/`;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveBackups(existingNames: string[]): Promise<string[]> {
        const names: Set<string> = new Set();
        const withMetadata: Set<string> = new Set();
        for (const key of await this.findKeys()) {
            const [name, ...rest] = key.slice(this.keyPrefix.length).split('/');
            // an object directly under the prefix is none of ours
            if (name == undefined || !rest.length) {
                continue;
            }
            names.add(name);
            if (rest.join('/') === METADATA_FILENAME) {
                withMetadata.add(name);
            }
        }

        const documents: (string | undefined)[] = await Promise.all([...names].map(async name => {
            if (existingNames.includes(name)) {
                return;
            }
            if (!withMetadata.has(name)) {
                // a backup holding data and no record is one that was interrupted before it finished:
                // the record is the last thing written, precisely so that this is what a half-finished
                // one looks like from here
                this.logger.warn(
                    `Could not find the metadata needed to resolve the backup "${name}" in the bucket "${this.options.bucket}"`
                );
                return;
            }
            return await this.resolveMetadata(name);
        }));
        return documents.filter(d => d != undefined);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await this.upload(this.resolveResourceKey(backup, resource), data);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async storeMetadata(backup: BackupEntity, document: string): Promise<void> {
        await this.putObject(this.resolveMetadataKey(backup.name), Buffer.from(document));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Promise<Readable> {
        if (resource.size == undefined) {
            throw new InternalError(`The backup "${backup.name}" recorded no size for "${resource.name}", so it cannot be retrieved.`);
        }
        const request: S3Request = this.resolveRequest(HttpMethod.GET, this.resolveResourceKey(backup, resource), {}, '');
        // no larger than what was stored: an object that has grown since is refused while it arrives,
        // rather than after it was written to disk in full
        return (await this.httpClient.get(request.url, {
            headers: request.headers,
            responseBody: { type: MimeType.OCTET_STREAM, maxSize: `${resource.size}b` },
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            attempts: ATTEMPTS
        })).body;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await this.deleteObject(this.resolveResourceKey(backup, resource));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteMetadata(backup: BackupEntity): Promise<void> {
        await this.deleteObject(this.resolveMetadataKey(backup.name));
    }

    private async deleteObject(key: string): Promise<void> {
        const request: S3Request = this.resolveRequest(HttpMethod.DELETE, key, {}, '');
        await this.httpClient.delete(request.url, {
            headers: request.headers,
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            attempts: ATTEMPTS
        });
    }

    private async upload(key: string, data: AsyncIterable<unknown>): Promise<void> {
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
                uploadId ??= await this.initiateMultipartUpload(key);
                parts.push(await this.uploadPart(key, uploadId, parts.length + 1, Buffer.concat(chunks)));
                chunks = [];
                buffered = 0;
            }

            if (uploadId == undefined) {
                await this.putObject(key, Buffer.concat(chunks));
                return;
            }
            if (buffered > 0) {
                parts.push(await this.uploadPart(key, uploadId, parts.length + 1, Buffer.concat(chunks)));
            }
            await this.completeMultipartUpload(key, uploadId, parts);
        }
        catch (error) {
            if (uploadId != undefined) {
                await this.abortMultipartUpload(key, uploadId);
            }
            throw error;
        }
    }

    private async findKeys(): Promise<string[]> {
        const keys: string[] = [];
        let continuationToken: string | undefined;
        do {
            const query: Record<string, string> = { 'list-type': '2', prefix: this.keyPrefix };
            if (continuationToken != undefined) {
                query['continuation-token'] = continuationToken;
            }
            const request: S3Request = this.resolveRequest(HttpMethod.GET, undefined, query, '');
            const page: S3ListBucketResult = (await this.httpClient.get(request.url, {
                headers: request.headers,
                responseBody: {
                    type: MimeType.XML,
                    modelClass: S3ListBucketResult,
                    allowAdditionalProperties: true,
                    maxSize: MAX_LISTING_PAGE_SIZE
                },
                timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                attempts: ATTEMPTS
            })).body;
            keys.push(...(page.contents ?? []).map(o => o.key));
            continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
        } while (continuationToken != undefined);
        return keys;
    }

    private async resolveMetadata(name: string): Promise<string> {
        const request: S3Request = this.resolveRequest(HttpMethod.GET, this.resolveMetadataKey(name), {}, '');
        // as a stream and read as text: the record is handed back as it was stored, never parsed here
        const data: Readable = (await this.httpClient.get(request.url, {
            headers: request.headers,
            responseBody: { type: MimeType.OCTET_STREAM, maxSize: MAX_METADATA_SIZE },
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            attempts: ATTEMPTS
        })).body;
        return await text(data);
    }

    private async putObject(key: string, body: Buffer): Promise<void> {
        const request: S3Request = this.resolveRequest(HttpMethod.PUT, key, {}, body);
        await this.httpClient.put(request.url, new Blob([new Uint8Array(body)]), {
            headers: request.headers,
            requestBodyType: MimeType.OCTET_STREAM,
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            attempts: ATTEMPTS
        });
    }

    private async initiateMultipartUpload(key: string): Promise<string> {
        const request: S3Request = this.resolveRequest(HttpMethod.POST, key, { uploads: '' }, '');
        // the type the object is stored with is named here rather than by its parts. Without it, the service
        // stores a type of its own choosing, eg. binary/octet-stream, which the object is not read back as
        return (await this.httpClient.post(request.url, undefined, {
            headers: { ...request.headers, [KnownHeader.CONTENT_TYPE]: MimeType.OCTET_STREAM },
            responseBody: { type: MimeType.XML, modelClass: S3InitiateMultipartUploadResult, allowAdditionalProperties: true },
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        })).body.uploadId;
    }

    private async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<S3CompletedPart> {
        if (partNumber > MAX_PARTS) {
            throw new InternalError(
                `"${key}" is larger than ${MAX_PARTS} parts of ${this.options.partSize ?? DEFAULT_PART_SIZE}. `
                + `Raise the partSize of the transport "${this.name}".`
            );
        }
        const request: S3Request = this.resolveRequest(HttpMethod.PUT, key, { partNumber: String(partNumber), uploadId }, body);
        const { headers } = await this.httpClient.put(request.url, new Blob([new Uint8Array(body)]), {
            headers: request.headers,
            requestBodyType: MimeType.OCTET_STREAM,
            responseHeaders: { etag: { type: 'string' } },
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            attempts: ATTEMPTS
        });
        return { partNumber, eTag: headers.etag };
    }

    private async completeMultipartUpload(key: string, uploadId: string, parts: S3CompletedPart[]): Promise<void> {
        const xml: XmlString = await XmlUtilities.generateFrom(S3CompleteMultipartUpload, { parts });
        const request: S3Request = this.resolveRequest(HttpMethod.POST, key, { uploadId }, xml);
        // the result is read even though nothing in it is needed: a service can answer this with a 200 whose
        // body is an error, and that body has no ETag
        await this.httpClient.post(request.url, xml, {
            headers: request.headers,
            requestBodyType: MimeType.XML,
            responseBody: { type: MimeType.XML, modelClass: S3CompleteMultipartUploadResult, allowAdditionalProperties: true },
            timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        });
    }

    private async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
        const request: S3Request = this.resolveRequest(HttpMethod.DELETE, key, { uploadId }, '');
        try {
            await this.httpClient.delete(request.url, {
                headers: request.headers,
                timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                attempts: ATTEMPTS
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

    private resolveRequest(method: HttpMethod, key: string | undefined, query: Record<string, string>, body: Buffer | string): S3Request {
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

        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method,
            url,
            headers: {},
            payloadHash: S3SignatureUtilities.hash(body),
            accessKeyId: this.options.accessKeyId,
            secretAccessKey: this.options.secretAccessKey,
            region: this.options.region,
            date: new Date()
        });
        return { url: url.toString(), headers };
    }

    private resolvePartSize(): BigNumber {
        const partSize: BigNumber = fileSizeToBytes(this.options.partSize ?? DEFAULT_PART_SIZE);
        if (partSize.isLessThan(fileSizeToBytes(MIN_PART_SIZE)) || partSize.isGreaterThan(fileSizeToBytes(MAX_PART_SIZE))) {
            throw new InternalError(
                `The partSize of the transport "${this.name}" has to be between ${MIN_PART_SIZE} and ${MAX_PART_SIZE}.`
            );
        }
        return partSize;
    }

    private resolveResourceKey(backup: BackupEntity, resource: BackupResourceEntity): string {
        return `${this.keyPrefix}${backup.name}/${resource.name}`;
    }

    private resolveMetadataKey(backupName: string): string {
        return `${this.keyPrefix}${backupName}/${METADATA_FILENAME}`;
    }
}