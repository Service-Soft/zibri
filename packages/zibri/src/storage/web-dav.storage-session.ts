import { Readable } from 'node:stream';

import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpClientBufferedBody } from '../http-client/http-client-buffered-body.model';
import { LoggerInterface } from '../logging/logger.interface';
import { Ms } from '../utilities/ms';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConflictError } from '../web-dav/web-dav-conflict.error';
import { WebDavEntry } from '../web-dav/web-dav-entry.model';
import { WebDavForbiddenError } from '../web-dav/web-dav-forbidden.error';
import { WebDavNotFoundError } from '../web-dav/web-dav-not-found.error';
import { StorageEntry } from './storage-entry.model';
import { StorageNaming } from './storage-naming.model';
import { StorageSessionInterface } from './storage-session.interface';

// a put is written under a name of its own beside its key and moved into place once complete, so that a reader never
// sees part of it. The listings leave these names out, and a key may not hold one
const UPLOAD_PREFIX: string = '.zibri-upload-';
// how long an upload goes unmoved before it counts as left behind by a process that ended between the upload and the
// move: a put moves it right after it arrived. By this machine's clock against the time the server names, which a day
// leaves room to differ
const ABANDONED_UPLOAD_AGE_MS: number = Ms.DAY;
// a page of a listing, as the other stores hand them over
const PAGE_SIZE: number = 1000;
// how many requests one call sends at once: a server answering for a whole office is no place for a thousand
const REQUESTS_AT_ONCE: number = 8;
const CONTENT_TYPE: string = 'application/octet-stream';

/**
 * A session with a folder of a WebDAV server: each key a file below the folder, its segments the folders leading to
 * it. Every request stands on its own, so a session holds nothing open.
 *
 * A put is held in memory while it is uploaded, under a name of its own beside its key, and moved onto the key once it
 * arrived whole. What a put that ended in between left under that name is deleted by `deleteAbandonedUploads` a day
 * later. A class building on it, such as for a Nextcloud, checks the folder before the first put of a session
 * with `prepareWrite`, and handles what a delete removed with `handleDeleted`.
 */
export class WebDavStorageSession implements StorageSessionInterface {
    /**
     * The check of the folder before the first put, once per session.
     */
    private writePrepared: Promise<void> | undefined;

    /**
     * Creates the session with a folder.
     * @param naming - How the errors name the store.
     * @param client - The client of the server.
     * @param folder - The folder the keys are below, relative to the url of the connection, `''` for the folder of
     * the connection.
     */
    constructor(
        protected readonly naming: StorageNaming,
        protected readonly client: WebDavClient,
        protected readonly folder: string
    ) {}

    /**
     * The logger a class building on this one reports through.
     * @returns The logger.
     */
    protected get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        const segments: string[] = this.resolveSegments(key);
        await (this.writePrepared ??= this.prepareWrite());
        // whole before anything is sent: the size goes with the request, which some servers insist on, and data that
        // fails part way sends nothing
        const chunks: Buffer[] = [];
        for await (const chunk of data) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const body: HttpClientBufferedBody = new HttpClientBufferedBody(chunks);
        const target: string = this.resolvePath(segments);
        // a name of its own per put, so that two puts of one key at once do not write into each other
        const upload: string = this.resolvePath([...segments.slice(0, -1), `${UPLOAD_PREFIX}${UUIDUtilities.generate()}`]);
        try {
            await this.putCreatingFolders(upload, body);
            await this.client.move(upload, target, { overwrite: true });
        }
        catch (error) {
            await this.deleteUpload(upload);
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const path: string = this.resolvePath(this.resolveSegments(key));
        try {
            // refused before any of it is read where the server names its size, and while it arrives otherwise
            return (await this.client.get(path, `${maxBytes}b`)).content;
        }
        catch (error) {
            if (error instanceof WebDavNotFoundError) {
                throw this.naming.createKeyNotFoundError(key);
            }
            if (error instanceof WebDavForbiddenError) {
                throw this.naming.createKeyAccessDeniedError(key, error);
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(key: string): Promise<StorageEntry | undefined> {
        const entry: WebDavEntry | undefined = await this.client.findEntry(this.resolvePath(this.resolveSegments(key)));
        // a folder holds keys rather than being one
        if (entry == undefined || entry.kind === 'folder') {
            return undefined;
        }
        if (entry.size == undefined || entry.modifiedAt == undefined) {
            throw new InternalError(`The WebDAV server of the ${this.naming.subject} names no size or time of "${key}".`);
        }
        return { size: entry.size, modifiedAt: entry.modifiedAt };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        // from the folder the prefix names rather than from the top, so that listing one part of the store does not
        // walk all of it
        const folder: string[] = prefix.includes('/') ? this.resolveSegments(prefix.slice(0, prefix.lastIndexOf('/'))) : [];
        for await (const keys of this.walk(folder, prefix)) {
            for (let i: number = 0; i < keys.length; i += PAGE_SIZE) {
                yield keys.slice(i, i + PAGE_SIZE);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findNames(keyPath: string): AsyncIterable<string[]> {
        const names: string[] = (await this.findEntriesOf(keyPath === '' ? [] : this.resolveSegments(keyPath)))
            .map(entry => entry.name);
        for (let i: number = 0; i < names.length; i += PAGE_SIZE) {
            yield names.slice(i, i + PAGE_SIZE);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await this.deleteFiles(keys.map(key => this.resolveSegments(key)));
    }

    /**
     * Deletes the uploads of puts that ended between the upload and the move, such as with a process that went down,
     * once a day has passed since the server says they were written, with the folders that held nothing else. Every
     * folder below the folder of the store is listed for them, one level at a time.
     */
    async deleteAbandonedUploads(): Promise<void> {
        const abandoned: string[][] = await this.findAbandonedUploads([], Date.now() - ABANDONED_UPLOAD_AGE_MS);
        if (!abandoned.length) {
            return;
        }
        await this.deleteFiles(abandoned);
        this.logger.info(`Deleted ${abandoned.length} uploads a put left behind a day ago or earlier from the ${this.naming.subject}.`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async close(): Promise<void> {
        // every request stands on its own, and a stream of `get` ends with its response
        await Promise.resolve();
    }

    /**
     * Checks the folder before the first put of a session, for a class building on this one. Nothing by default.
     */
    protected async prepareWrite(): Promise<void> {
        await Promise.resolve();
    }

    /**
     * Handles the files and folders a delete removed, for a class building on this one, such as by deleting them from
     * a trash bin too. Nothing by default.
     * @param paths - Their paths, relative to the url of the connection.
     */
    protected async handleDeleted(paths: string[]): Promise<void> {
        await Promise.resolve(paths);
    }

    /**
     * Resolves the path of segments below the folder, relative to the url of the connection.
     * @param segments - The segments.
     * @returns The path, `''` for the folder of the connection.
     */
    protected resolvePath(segments: string[]): string {
        return [...this.folder === '' ? [] : [this.folder], ...segments].join('/');
    }

    /**
     * Resolves the segments of a key, or of a path of keys.
     * @param key - The key.
     * @returns Its segments.
     * @throws When a segment could lead outside the folder, or is the name of a put still running.
     */
    private resolveSegments(key: string): string[] {
        const segments: string[] = this.naming.resolveKeySegments(key);
        if (segments.some(segment => segment.startsWith(UPLOAD_PREFIX))) {
            throw new InternalError(`The key "${key}" of the ${this.naming.subject} needs segments that do not start with "${UPLOAD_PREFIX}".`);
        }
        return segments;
    }

    /**
     * Puts an upload, creating the folders it goes into when they do not exist.
     * @param path - The path of the upload.
     * @param body - What it holds.
     */
    private async putCreatingFolders(path: string, body: HttpClientBufferedBody): Promise<void> {
        try {
            await this.client.put(path, body, { contentType: CONTENT_TYPE, overwrite: true });
        }
        catch (error) {
            // put first and the folders created only when missing: most keys go into a folder that exists, where
            // creating it first would cost two requests of every put
            const parent: string = path.split('/').slice(0, -1)
                .join('/');
            // the folder of the connection is not created: a url that leads nowhere is a mistake to report
            if (!(error instanceof WebDavConflictError) || parent === '') {
                throw error;
            }
            await this.client.createFolder(parent);
            await this.client.put(path, body, { contentType: CONTENT_TYPE, overwrite: true });
        }
    }

    /**
     * Deletes what a put that failed left under its own name, if anything.
     * @param path - The path of the upload.
     */
    private async deleteUpload(path: string): Promise<void> {
        try {
            await this.deleteIfThere(path);
        }
        catch (error) {
            // the put fails with its own error. What is left stays out of every listing, and takes up its size
            this.logger.warn(
                `Could not delete "${path}", left by a put that failed, from the ${this.naming.subject}: `
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    /**
     * Deletes files below the folder of the store, the folders they emptied, and hands both to `handleDeleted`.
     * @param files - The segments of each file, below the folder of the store.
     */
    private async deleteFiles(files: string[][]): Promise<void> {
        await PromiseUtilities.allChunked(files, async file => await this.deleteIfThere(this.resolvePath(file)), { chunkSize: REQUESTS_AT_ONCE });
        const removedFolders: string[] = await this.removeEmptiedFolders(files);
        await this.handleDeleted([...files.map(file => this.resolvePath(file)), ...removedFolders]);
    }

    /**
     * Finds the uploads in a folder and the folders below it that were written before a moment.
     * @param folder - The segments of the folder, none for the folder of the store.
     * @param writtenBefore - The moment, in milliseconds since the epoch.
     * @returns The segments of each upload, below the folder of the store.
     */
    private async findAbandonedUploads(folder: string[], writtenBefore: number): Promise<string[][]> {
        const abandoned: string[][] = [];
        // one level at a time, as the listings: many servers refuse a listing of infinite depth
        for (const entry of await this.findEntriesOf(folder, true)) {
            if (entry.kind === 'folder') {
                abandoned.push(...await this.findAbandonedUploads([...folder, entry.name], writtenBefore));
                continue;
            }
            // an upload of a server naming no time is kept: how long it went unmoved cannot be told
            if (entry.name.startsWith(UPLOAD_PREFIX) && entry.modifiedAt != undefined && entry.modifiedAt.getTime() < writtenBefore) {
                abandoned.push([...folder, entry.name]);
            }
        }
        return abandoned;
    }

    /**
     * Deletes a file or a folder, where there is one.
     * @param path - Its path, relative to the url of the connection.
     */
    private async deleteIfThere(path: string): Promise<void> {
        try {
            await this.client.delete(path);
        }
        catch (error) {
            if (!(error instanceof WebDavNotFoundError)) {
                throw error;
            }
        }
    }

    /**
     * Removes the folders deleted keys were in that hold nothing any more, the deepest first, up to the folder of the
     * store.
     * @param keys - The segments of the keys that were deleted.
     * @returns The paths of the folders removed.
     */
    private async removeEmptiedFolders(keys: string[][]): Promise<string[]> {
        // a backup's folder left behind empty would be read as a backup that was interrupted, on every sync
        const byDepth: Map<number, Set<string>> = new Map();
        for (const key of keys) {
            for (let depth: number = 1; depth < key.length; depth++) {
                const folders: Set<string> = byDepth.get(depth) ?? new Set();
                folders.add(key.slice(0, depth).join('/'));
                byDepth.set(depth, folders);
            }
        }
        const removed: string[] = [];
        // a folder that holds something keeps the folders above it from being empty as well
        const kept: Set<string> = new Set();
        for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
            const candidates: string[] = [...byDepth.get(depth) ?? []].filter(folder => !kept.has(folder));
            await PromiseUtilities.allChunked(candidates, async folder => {
                const segments: string[] = folder.split('/');
                if (await this.removeFolderIfEmpty(segments)) {
                    removed.push(this.resolvePath(segments));
                    return;
                }
                for (let above: number = 1; above < segments.length; above++) {
                    kept.add(segments.slice(0, above).join('/'));
                }
            }, { chunkSize: REQUESTS_AT_ONCE });
        }
        return removed;
    }

    /**
     * Removes a folder that holds nothing.
     * @param segments - The segments of the folder, below the folder of the store.
     * @returns Whether it was removed, or was not there.
     */
    private async removeFolderIfEmpty(segments: string[]): Promise<boolean> {
        // WebDAV has no delete of a folder only while it is empty, so it is listed right before. A put into it in
        // between is what a garbage collection rules out while it deletes, and an upload still running is listed
        if ((await this.findEntriesOf(segments, true)).length) {
            return false;
        }
        await this.deleteIfThere(this.resolvePath(segments));
        return true;
    }

    /**
     * The keys starting with a prefix, a folder's own at a time: each folder is a round trip, so the keys of one are
     * handed over before the next is read, and only a folder that can hold such a key is read at all.
     * @param folder - The segments of the folder to start in, none for the top.
     * @param prefix - The prefix.
     * @yields The keys directly in each folder, before those of the folders in it.
     */
    private async* walk(folder: string[], prefix: string): AsyncGenerator<string[]> {
        // one level at a time: many servers refuse a listing of infinite depth
        const entries: WebDavEntry[] = await this.findEntriesOf(folder);
        const keys: string[] = [];
        const folders: string[][] = [];
        for (const entry of entries) {
            const key: string = [...folder, entry.name].join('/');
            if (entry.kind === 'file') {
                if (key.startsWith(prefix)) {
                    keys.push(key);
                }
            }
            // a folder whose keys start with the prefix, or one on the way to such a folder
            else if (`${key}/`.startsWith(prefix) || prefix.startsWith(`${key}/`)) {
                folders.push([...folder, entry.name]);
            }
        }
        if (keys.length) {
            yield keys;
        }
        for (const below of folders) {
            yield* this.walk(below, prefix);
        }
    }

    /**
     * Finds what is directly in a folder below the folder of the store.
     * @param segments - The segments of the folder, none for the folder of the store.
     * @param withUploads - Whether the puts still running are among them.
     * @returns The files and folders, none for a folder that does not exist.
     */
    private async findEntriesOf(segments: string[], withUploads: boolean = false): Promise<WebDavEntry[]> {
        let entries: WebDavEntry[];
        try {
            entries = await this.client.findEntries(this.resolvePath(segments));
        }
        catch (error) {
            // a store nothing was put into yet has no folder
            if (error instanceof WebDavNotFoundError) {
                return [];
            }
            throw error;
        }
        return withUploads ? entries : entries.filter(entry => !entry.name.startsWith(UPLOAD_PREFIX));
    }
}
