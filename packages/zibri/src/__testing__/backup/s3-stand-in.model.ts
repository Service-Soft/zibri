import { createReadStream, createWriteStream, Stats } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { pipeline } from 'node:stream/promises';

import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

/**
 * The most keys a page of a listing holds, as the service has it.
 */
const LISTING_PAGE_SIZE: number = 1000;

/**
 * A service in the test's own process that answers what the S3 backup transport sends, for measuring
 * a backup through it where no container runs.
 *
 * Objects are kept on disk rather than in memory, so that what the service holds weighs nothing on a
 * measurement. It checks no signature or digest and keeps one bucket under any name, but refuses an
 * upload without a length as the service does: what is measured with it is what the transport does,
 * and the suites against a real service check what that service accepts.
 */
export class S3StandIn {
    private server: Server | undefined;

    /**
     * Creates the service, which starts once {@link start} is called.
     * @param folder - Where the objects are kept.
     */
    constructor(private readonly folder: FsPath) {}

    /**
     * Where the service is reached, once it was started.
     * @returns The endpoint, without a trailing slash.
     * @throws When it was not started.
     */
    getEndpoint(): string {
        const address: string | AddressInfo | null | undefined = this.server?.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The S3 stand-in was not started.');
        }
        return `http://127.0.0.1:${address.port}`;
    }

    /**
     * Starts the service on a free port.
     */
    async start(): Promise<void> {
        await FsUtilities.mkdir(this.folder);
        this.server = createServer((request, response) => {
            void (async () => {
                try {
                    await this.answer(request, response);
                }
                catch (error) {
                    // a client that stops reading part way, as a transport refusing a larger object does, ends
                    // the answer it already has the headers of: the connection is gone, and there is no other
                    if (response.headersSent) {
                        response.destroy();
                        return;
                    }
                    response.writeHead(500).end(String(error));
                }
            })();
        });
        const server: Server = this.server;
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    }

    /**
     * Stops the service, and removes what it kept.
     */
    async stop(): Promise<void> {
        const server: Server | undefined = this.server;
        if (server != undefined) {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        await FsUtilities.rm(this.folder);
    }

    /**
     * Answers one request: an object put, got or deleted, an upload in parts, or a listing.
     * @param request - The request.
     * @param response - Where the answer goes.
     */
    private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url: URL = new URL(request.url ?? '/', 'http://stand-in');
        // the first segment is the bucket, the rest the key
        const key: string = url.pathname.split('/').slice(2)
            .map(segment => decodeURIComponent(segment))
            .join('/');
        const uploadId: string | null = url.searchParams.get('uploadId');
        switch (request.method) {
            case 'GET': {
                if (key === '') {
                    await this.answerListing(
                        url.searchParams.get('prefix') ?? '',
                        url.searchParams.get('delimiter'),
                        url.searchParams.get('continuation-token'),
                        response
                    );
                    return;
                }
                await this.answerObject(key, response);
                return;
            }
            case 'HEAD': {
                await this.answerObjectHead(key, response);
                return;
            }
            case 'PUT': {
                // as the service does, which takes no upload it is not told the length of up front
                if (request.headers['content-length'] == undefined) {
                    response.writeHead(411).end('<Error><Code>MissingContentLength</Code></Error>');
                    return;
                }
                const partNumber: string | null = url.searchParams.get('partNumber');
                const file: FsPath = uploadId == undefined || partNumber == undefined
                    ? this.resolveObjectFile(key)
                    : FsUtilities.getPath(this.resolveUploadFolder(uploadId), partNumber.padStart(5, '0'));
                await pipeline(request, createWriteStream(file));
                response.writeHead(200, { etag: `"${UUIDUtilities.generate()}"` }).end();
                return;
            }
            case 'POST': {
                if (url.searchParams.has('delete')) {
                    await this.deleteObjects(request);
                    response.writeHead(200).end('<DeleteResult></DeleteResult>');
                    return;
                }
                if (url.searchParams.has('uploads')) {
                    const id: string = UUIDUtilities.generate();
                    await FsUtilities.mkdir(this.resolveUploadFolder(id));
                    response.writeHead(200)
                        .end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
                    return;
                }
                await this.completeUpload(key, uploadId ?? '', request);
                response.writeHead(200)
                    .end(`<CompleteMultipartUploadResult><ETag>"${UUIDUtilities.generate()}"</ETag></CompleteMultipartUploadResult>`);
                return;
            }
            case 'DELETE': {
                await FsUtilities.rm(uploadId == undefined ? this.resolveObjectFile(key) : this.resolveUploadFolder(uploadId));
                response.writeHead(204).end();
                return;
            }
            case undefined:
            default: {
                response.writeHead(405).end();
            }
        }
    }

    /**
     * Answers a page of the listing of every key under a prefix, in the order of the keys, at most as
     * many as the service puts on a page.
     * @param prefix - The prefix.
     * @param delimiter - What the keys sharing a prefix up to it are listed once by, as a common prefix,
     * or null to list every key.
     * @param continuationToken - Where the page starts, as the page before it said, or null for the first.
     * @param response - Where the answer goes.
     */
    private async answerListing(
        prefix: string,
        delimiter: string | null,
        continuationToken: string | null,
        response: ServerResponse
    ): Promise<void> {
        const keys: string[] = (await FsUtilities.readdir(this.folder))
            .map(entry => entry.name)
            .filter(name => name.startsWith('object-'))
            .map(name => decodeURIComponent(name.slice('object-'.length)))
            .filter(name => name.startsWith(prefix));
        // a key with the delimiter after the prefix stands for its common prefix, which the service lists
        // once and counts as one entry of a page
        const entries: string[] = [
            ...new Set(keys.map(k => {
                const end: number = delimiter == undefined ? -1 : k.indexOf(delimiter, prefix.length);
                return end === -1 || delimiter == undefined ? k : k.slice(0, end + delimiter.length);
            }))
        ].sort();
        const start: number = continuationToken == undefined ? 0 : Number(continuationToken);
        const page: string[] = entries.slice(start, start + LISTING_PAGE_SIZE);
        const truncated: boolean = start + LISTING_PAGE_SIZE < entries.length;
        const contents: string = page.map(e => delimiter != undefined && e.endsWith(delimiter)
            ? `<CommonPrefixes><Prefix>${e}</Prefix></CommonPrefixes>`
            : `<Contents><Key>${e}</Key></Contents>`).join('');
        const next: string = truncated ? `<NextContinuationToken>${start + LISTING_PAGE_SIZE}</NextContinuationToken>` : '';
        response.writeHead(200).end(`<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${next}${contents}</ListBucketResult>`);
    }

    /**
     * Deletes the objects a request deleting several names, one that is not there counting as deleted.
     * @param request - The request, whose body names the keys.
     */
    private async deleteObjects(request: IncomingMessage): Promise<void> {
        let body: string = '';
        for await (const chunk of request) {
            body += String(chunk);
        }
        const keys: string[] = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map(match => match[1] ?? '');
        await Promise.all(keys.map(async key => await FsUtilities.rm(this.resolveObjectFile(key))));
    }

    /**
     * Answers with an object, streamed from disk.
     * @param key - Its key.
     * @param response - Where the answer goes.
     */
    private async answerObject(key: string, response: ServerResponse): Promise<void> {
        const file: FsPath = this.resolveObjectFile(key);
        if (!await FsUtilities.exists(file)) {
            response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
            return;
        }
        response.writeHead(200, { 'content-length': (await FsUtilities.stat(file)).size });
        await pipeline(createReadStream(file), response);
    }

    /**
     * Answers with the headers of an object, its size and when it was written, as the service does.
     * @param key - Its key.
     * @param response - Where the answer goes.
     */
    private async answerObjectHead(key: string, response: ServerResponse): Promise<void> {
        const file: FsPath = this.resolveObjectFile(key);
        if (!await FsUtilities.exists(file)) {
            response.writeHead(404).end();
            return;
        }
        const stats: Stats = await FsUtilities.stat(file);
        response.writeHead(200, { 'content-length': stats.size, 'last-modified': stats.mtime.toUTCString() }).end();
    }

    /**
     * Joins the parts of an upload into its object, in the order of their numbers.
     * @param key - The object's key.
     * @param uploadId - The upload.
     * @param request - The request completing it, whose list of parts is read and not checked.
     */
    private async completeUpload(key: string, uploadId: string, request: IncomingMessage): Promise<void> {
        for await (const chunk of request) {
            // the list of parts, which the parts on disk already say
            void chunk;
        }
        const folder: FsPath = this.resolveUploadFolder(uploadId);
        const target: FsPath = this.resolveObjectFile(key);
        await FsUtilities.rm(target);
        for (const part of (await FsUtilities.readdir(folder)).map(entry => entry.name).sort()) {
            await pipeline(createReadStream(FsUtilities.getPath(folder, part)), createWriteStream(target, { flags: 'a' }));
        }
        await FsUtilities.rm(folder);
    }

    private resolveObjectFile(key: string): FsPath {
        return FsUtilities.getPath(this.folder, `object-${encodeURIComponent(key)}`);
    }

    private resolveUploadFolder(uploadId: string): FsPath {
        return FsUtilities.getPath(this.folder, `upload-${uploadId}`);
    }
}