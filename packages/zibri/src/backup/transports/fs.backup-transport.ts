import { Dirent } from 'node:fs';
import { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

// what the listings leave out: the staging folder, and the files the transports of 3.0 wrote beside a
// name until they were complete, which one going down left behind there
const PARTIAL_SUFFIX: string = '.partial';
// a put is written into this folder at the top of the store and renamed into place once complete, so that
// a reader never sees part of it. One folder rather than beside each key, so that what a process going down
// left behind is found without walking the store, and a backup's folder holds nothing but whole blobs
const STAGING_FOLDER: string = PARTIAL_SUFFIX;
// how long a file in the staging folder goes unwritten before it counts as left behind: a put still running
// keeps writing into it
const STAGED_FILE_LIFETIME_MS: number = Ms.DAY;

// how many keys a page of findKeys holds
const PAGE_SIZE: number = 1000;

/**
 * A transport that keeps the backups in a folder of this instance's own disk: each key a file, its segments the
 * folders leading to it. Of both versions, used as `v2`.
 *
 * Backups are kept under `<folder>/.zibri-repository/`, and backups of format 1 under `<folder>/<backup name>/`.
 */
export class FsBackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups in the given folder.
     * @param name - The name of the transport.
     * @param folder - The folder the backups are kept in.
     */
    constructor(readonly name: string, private readonly folder: FsPath) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        return await Promise.resolve(new FsBackupTransportSession(this.name, this.folder));
    }
}

/**
 * A session with the folder, which holds nothing open.
 */
class FsBackupTransportSession implements BackupTransportSessionInterface {
    // at the first put rather than when the session opens, so that a session only reading, a restore from a
    // folder it may not write to among them, changes nothing
    private stagingFolderPrepared: Promise<void> | undefined;

    constructor(private readonly storeName: string, private readonly folder: FsPath) {}

    /**
     * Writes a blob, which is on the disk once this returns: a machine going down right after finds it
     * whole under its key, or not at all.
     * @param key - The key.
     * @param data - The blob.
     */
    async put(key: string, data: Readable): Promise<void> {
        const target: FsPath = this.resolvePath(key);
        const folder: FsPath = FsUtilities.dirName(target);
        const created: FsPath | undefined = await FsUtilities.mkdir(folder);
        await (this.stagingFolderPrepared ??= this.prepareStagingFolder());
        // a name of its own per put, so that two puts of one key at once do not write into each other
        const partial: FsPath = FsUtilities.getPath(this.folder, STAGING_FOLDER, UUIDUtilities.generate());
        try {
            await pipeline(data, FsUtilities.createWriteStream(partial));
            // on the disk before it takes its name: renamed first, a machine going down could leave the name
            // holding part of the blob or none of it, which the record written after it would count on
            await FsUtilities.sync(partial);
            await FsUtilities.rename(partial, target);
        }
        catch (error) {
            await FsUtilities.rm(partial);
            throw error;
        }
        // the name itself, and each folder created for it in the one holding it
        for (const synced of this.resolveFoldersToSync(folder, created)) {
            await FsUtilities.syncDirectory(synced);
        }
    }

    /**
     * Creates the staging folder, and deletes what puts that ended without removing it left there.
     */
    private async prepareStagingFolder(): Promise<void> {
        const staging: FsPath = FsUtilities.getPath(this.folder, STAGING_FOLDER);
        const cutoff: number = Date.now() - STAGED_FILE_LIFETIME_MS;
        await Promise.all((await this.findEntries(STAGING_FOLDER)).map(async entry => {
            const file: FsPath = FsUtilities.getPath(staging, entry.name);
            let modifiedAt: number;
            try {
                modifiedAt = (await FsUtilities.stat(file)).mtimeMs;
            }
            catch (error) {
                // renamed into place since, or deleted by another session doing the same
                if (this.isNotFound(error)) {
                    return;
                }
                throw error;
            }
            if (modifiedAt < cutoff) {
                await FsUtilities.rm(file);
            }
        }));
        await FsUtilities.mkdir(staging);
    }

    /**
     * The folders whose entries a put changed: the one holding the blob, and of each folder it created, the
     * one holding that.
     * @param folder - The folder holding the blob.
     * @param created - The first folder the put created, the one closest to the root, if any.
     * @returns The folders, the deepest first.
     */
    private resolveFoldersToSync(folder: FsPath, created: FsPath | undefined): FsPath[] {
        const res: FsPath[] = [folder];
        if (created == undefined) {
            return res;
        }
        const top: FsPath = FsUtilities.dirName(created);
        for (let at: FsPath = folder; at !== top && at !== FsUtilities.dirName(at); at = FsUtilities.dirName(at)) {
            res.push(FsUtilities.dirName(at));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const target: FsPath = this.resolvePath(key);
        let file: FileHandle;
        try {
            // opened here rather than by the stream, which would fail with a file it may not read only once
            // it is read, as an error of the stream nobody could tell apart from any other
            file = await FsUtilities.openForReading(target);
        }
        catch (error) {
            // a key below a key holds nothing either
            if (this.isNotFound(error) || this.isNotFolder(error)) {
                throw new BackupKeyNotFoundError(this.storeName, key);
            }
            if (this.isAccessDenied(error)) {
                throw new BackupKeyAccessDeniedError(this.storeName, key, error);
            }
            throw error;
        }
        try {
            const size: number = (await file.stat()).size;
            if (size > maxBytes) {
                throw new InternalError(`"${target}" is ${size} bytes, larger than the ${maxBytes} it may be.`);
            }
        }
        catch (error) {
            await file.close();
            throw error;
        }
        return file.createReadStream();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        // from the folder the prefix names rather than from the top, so that listing one part of the
        // store does not walk all of it
        const folder: string | undefined = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : undefined;
        for await (const keys of this.walk(folder, prefix)) {
            for (let i: number = 0; i < keys.length; i += PAGE_SIZE) {
                yield keys.slice(i, i + PAGE_SIZE);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findNames(path: string): AsyncIterable<string[]> {
        const names: string[] = (await this.findEntries(path === '' ? undefined : path))
            .filter(entry => !entry.name.endsWith(PARTIAL_SUFFIX))
            .map(entry => entry.name);
        for (let i: number = 0; i < names.length; i += PAGE_SIZE) {
            yield names.slice(i, i + PAGE_SIZE);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await Promise.all(keys.map(async key => await FsUtilities.rm(this.resolvePath(key))));
        // the folders a key was in go with their last key: a backup's folder left behind empty would be
        // read as a backup that was interrupted, and warned about on every sync. The deepest first
        const folders: string[] = [
            ...new Set(keys.flatMap(key => {
                const segments: string[] = resolveBackupKeySegments(this.storeName, key).slice(0, -1);
                return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
            }))
        ].sort((a, b) => b.split('/').length - a.split('/').length);
        for (const folder of folders) {
            await FsUtilities.rmIfEmpty(FsUtilities.getPath(this.folder, ...folder.split('/')));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async close(): Promise<void> {
        // nothing is held open
    }

    /**
     * The keys starting with a prefix, a folder's own at a time: the keys of one are handed over before the next
     * is read, and only a folder that can hold such a key is read at all.
     * @param relative - The folder to start in, undefined for the top.
     * @param prefix - The prefix.
     * @yields The keys directly in each folder, before those of the folders in it.
     */
    private async* walk(relative: string | undefined, prefix: string): AsyncGenerator<string[]> {
        const keys: string[] = [];
        const folders: string[] = [];
        for (const entry of await this.findEntries(relative)) {
            const key: string = relative == undefined ? entry.name : `${relative}/${entry.name}`;
            if (entry.name.endsWith(PARTIAL_SUFFIX)) {
                continue;
            }
            if (!entry.isDirectory()) {
                if (key.startsWith(prefix)) {
                    keys.push(key);
                }
            }
            // a folder whose keys start with the prefix, or one on the way to such a folder
            else if (`${key}/`.startsWith(prefix) || prefix.startsWith(`${key}/`)) {
                folders.push(key);
            }
        }
        if (keys.length) {
            yield keys;
        }
        for (const folder of folders) {
            yield* this.walk(folder, prefix);
        }
    }

    private async findEntries(relative: string | undefined): Promise<Dirent[]> {
        try {
            return await FsUtilities.readdir(relative == undefined ? this.folder : this.resolvePath(relative));
        }
        catch (error) {
            // a folder nothing was stored in yet holds no keys, and neither does a key
            if (this.isNotFound(error) || this.isNotFolder(error)) {
                return [];
            }
            throw error;
        }
    }

    private resolvePath(key: string): FsPath {
        return FsUtilities.getPath(this.folder, ...resolveBackupKeySegments(this.storeName, key));
    }

    private isNotFound(error: unknown): boolean {
        // by its shape: the error is built in node's realm, which instanceof cannot see from a jest one
        return typeof error === 'object' && error != undefined && 'code' in error && error.code === 'ENOENT';
    }

    private isNotFolder(error: unknown): boolean {
        return typeof error === 'object' && error != undefined && 'code' in error && error.code === 'ENOTDIR';
    }

    private isAccessDenied(error: unknown): boolean {
        return typeof error === 'object' && error != undefined && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM');
    }
}