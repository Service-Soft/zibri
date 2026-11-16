import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Client, ConnectConfig, FileEntryWithStats, ReadStream, SFTPWrapper, Stats, WriteStream } from 'ssh2';

import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';
import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { Ms } from '../../utilities/ms';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

// what the listings leave out: the staging folder, and the files the transport of 3.0 wrote beside a name
// until they were complete, which a connection ending left behind there
const PARTIAL_SUFFIX: string = '.partial';
// a put is written into this folder at the top of the store and renamed into place once complete, so that
// a reader never sees part of it. One folder rather than beside each key, so that what a connection ending
// left behind is found without walking the store, and a backup's folder holds nothing but whole blobs
const STAGING_FOLDER: string = PARTIAL_SUFFIX;
// how long a file in the staging folder goes unwritten before it counts as left behind: a put still running
// keeps writing into it. By this machine's clock against the server's, which a day leaves room to differ
const STAGED_FILE_LIFETIME_MS: number = Ms.DAY;
const FINGERPRINT_PREFIX: string = 'SHA256:';

const DEFAULT_PORT: number = 22;
const DEFAULT_CONNECT_TIMEOUT_MS: number = Ms.SECOND * 20;
// a server that stops answering would otherwise leave a backup waiting forever, since nothing on the
// connection has a timeout of its own. Three unanswered keepalive packets end it, which fails whatever was in flight
const KEEPALIVE_INTERVAL_MS: number = Ms.SECOND * 15;
const KEEPALIVE_COUNT_MAX: number = 3;
// the keepalive only ends a connection that is gone: a server that keeps it up and answers no request left a
// backup waiting forever. Longer than the keepalive takes, so that a connection that is gone ends by it
const DEFAULT_REQUEST_TIMEOUT_MS: number = Ms.SECOND * 60;
// how many times within the request timeout the pending requests are looked at
const REQUEST_CHECKS_PER_TIMEOUT: number = 4;

// as much as the ssh channel's window lets be in flight, which is what bounds a write of more anyway,
// and what a store holds in memory beyond the chunk it reads
const WRITE_BUFFER_BYTES: number = 2 * 1024 * 1024;
// what the protocol answers for a path that does not exist, SSH_FX_NO_SUCH_FILE
const NO_SUCH_FILE: number = 2;
// and for one the user it logged in as may not reach, SSH_FX_PERMISSION_DENIED
const PERMISSION_DENIED: number = 3;
// how many keys a page of findKeys holds
const PAGE_SIZE: number = 1000;

/**
 * What a session asked for, for the error naming it once the server answers nothing.
 */
type AskedRequest = {
    /**
     * The request, such as `REMOVE of "/backups/a"`.
     */
    what: string,
    /**
     * Whether the session waits for the server meanwhile, rather than for what reads a file or writes one.
     */
    awaitsServer: boolean
};

/**
 * A transport that stores backups in a folder on a server reached over SFTP: each key a file under `path`, its
 * segments the folders leading to it. Of both versions, used as `v2`. Needs the optional peer dependency `ssh2`.
 *
 * Backups are kept under `<path>/.zibri-repository/`, and backups of format 1 under `<path>/<backup name>/`.
 */
export class SftpBackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups on the given server.
     * @param name - The name of the transport.
     * @param options - Where the server is, how to log in, and the folder the backups are kept in.
     */
    constructor(readonly name: string, private readonly options: SftpBackupTransportOptions) {
        super();
        // when the transport is built rather than at the first backup, which can be days after the
        // deployment that left the package out
        optionalPeer('ssh2', 'The sftp backup transport');
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        this.validateHostKeyFingerprint();
        const { Client: SshClient } = optionalPeer<typeof import('ssh2')>('ssh2', 'The sftp backup transport');
        const client: Client = new SshClient();

        let presentedKey: Buffer | undefined;
        const config: ConnectConfig = {
            host: this.options.host,
            port: this.options.port ?? DEFAULT_PORT,
            username: this.options.username,
            ...this.options.authentication,
            readyTimeout: this.options.connectTimeoutInMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
            keepaliveInterval: KEEPALIVE_INTERVAL_MS,
            keepaliveCountMax: KEEPALIVE_COUNT_MAX,
            hostVerifier: (key: Buffer): boolean => {
                presentedKey = key;
                return this.resolveFingerprint(key) === this.options.hostKeyFingerprint;
            }
        };

        const connectTimeoutMs: number = this.options.connectTimeoutInMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        let sftp: SFTPWrapper;
        let subsystemTimer: NodeJS.Timeout | undefined;
        try {
            sftp = await new Promise((resolve, reject) => {
                client.once('error', reject);
                // ssh2 stops the ready timeout once the connection closes, and reports a server ending it as the
                // application, or after its greeting, as no error: the session waited forever
                const closedBeforeLogin: () => void = () => reject(new InternalError(
                    `The server "${this.options.host}" closed the connection of the transport "${this.name}" before the login completed.`
                ));
                client.once('close', closedBeforeLogin);
                client.once('ready', () => {
                    // from here, a connection closing fails the subsystem ssh2 asks for
                    client.removeListener('close', closedBeforeLogin);
                    // the ready timeout of ssh2 ends with the login: a server that logs in and opens no SFTP session
                    // left a backup waiting forever, before any request of it could go unanswered
                    subsystemTimer = setTimeout(() => reject(new InternalError(
                        `The server "${this.options.host}" did not open the SFTP subsystem for the transport "${this.name}" `
                        + `within ${connectTimeoutMs} ms.`
                    )), connectTimeoutMs);
                    client.sftp((error, wrapper) => error == undefined ? resolve(wrapper) : reject(error));
                });
                client.connect(config);
            });
        }
        catch (error) {
            client.end();
            if (presentedKey != undefined && this.resolveFingerprint(presentedKey) !== this.options.hostKeyFingerprint) {
                // named, because what a refused host key says by itself is only that verification failed - and
                // the key the server did present is what somebody setting this up needs to compare
                throw new InternalError(
                    `The server "${this.options.host}" identified itself with the ${this.resolveKeyType(presentedKey)} key `
                    + `${this.resolveFingerprint(presentedKey)}, not with the ${this.options.hostKeyFingerprint} `
                    + `the transport "${this.name}" expects.`,
                    { cause: error }
                );
            }
            throw error;
        }
        finally {
            clearTimeout(subsystemTimer);
        }
        // an error once the connection is up fails whatever is in flight on it by itself. Listened for, so
        // that it is not thrown at the process as an unhandled event
        client.on('error', error => {
            this.logger.warn(`The connection of the transport "${this.name}" to "${this.options.host}" failed: ${error.message}`);
        });
        try {
            return new SftpBackupTransportSession(this.name, this.options, client, sftp);
        }
        catch (error) {
            client.end();
            throw error;
        }
    }

    private validateHostKeyFingerprint(): void {
        if (!this.options.hostKeyFingerprint.startsWith(FINGERPRINT_PREFIX)) {
            throw new InternalError(
                `The hostKeyFingerprint of the transport "${this.name}" has to be a SHA256 fingerprint as "ssh-keygen -lf" `
                + `prints it, for example "${FINGERPRINT_PREFIX}uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s".`
            );
        }
    }

    private resolveFingerprint(key: Buffer): string {
        // what OpenSSH prints: the sha256 of the key as it is sent, in base64 without its padding
        const hash: string = createHash('sha256')
            .update(key)
            .digest('base64');
        return `${FINGERPRINT_PREFIX}${hash.replace(/=+$/, '')}`;
    }

    private resolveKeyType(key: Buffer): string {
        // the key as it is sent starts with its type, a string prefixed by its length
        return key.subarray(4, 4 + key.readUInt32BE(0)).toString();
    }
}

/**
 * A session with the server: one connection, and the file transfer session on it.
 */
class SftpBackupTransportSession implements BackupTransportSessionInterface {
    // the files `get` opened that have not closed yet, each with the stream it handed out for it
    private readonly reading: Map<ReadStream, Readable> = new Map();
    // what fails each request that waits for its answer, once the connection ended
    private readonly waiting: Set<(error: Error) => void> = new Set();
    // why nothing is answered any more, once the connection ended
    private ended: Error | undefined;
    // at the first put rather than when the session opens, so that a session only reading, a restore from a
    // folder it may not write to among them, changes nothing
    private stagingFolderPrepared: Promise<void> | undefined;
    // what the session waits for an answer to, by an id of its own, for the error naming it: ssh2's pending
    // requests say nothing of what they are
    private readonly asked: Map<number, AskedRequest> = new Map();
    private askedCount: number = 0;
    // the requests of ssh2 that waited for their answer at the last check, and when the server last answered one
    private pendingAtLastCheck: Set<string> = new Set();
    private lastAnsweredAt: number = performance.now();
    private readonly answersChecked: NodeJS.Timeout;

    constructor(
        private readonly storeName: string,
        private readonly options: SftpBackupTransportOptions,
        private readonly client: Client,
        private readonly sftp: SFTPWrapper
    ) {
        // once, so that an ssh2 keeping its requests another way fails the session at once rather than a server
        // that stops answering being waited for forever
        this.findPendingRequestIds();
        // ssh2 fails what is in flight when the connection ends, and leaves every request sent after
        // unanswered: the CLOSE a stream sends once it failed among them, so the stream never closes and a
        // pipeline into it never settles. So whatever still waits fails here, and nothing waits from now on
        const end: () => void = () => this.end(
            new InternalError(`The connection of the transport "${storeName}" to "${options.host}" ended.`)
        );
        client.once('close', end);
        sftp.once('close', end);
        const timeoutMs: number = options.requestTimeoutInMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.answersChecked = setInterval(() => this.checkAnswers(timeoutMs), timeoutMs / REQUEST_CHECKS_PER_TIMEOUT);
        this.answersChecked.unref();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        const target: string = this.resolvePath(key);
        await this.createDirectory(path.posix.dirname(target));
        await (this.stagingFolderPrepared ??= this.prepareStagingFolder());
        // a name of its own per put, so that two puts of one key at once do not write into each other
        const partial: string = path.posix.join(this.options.path, STAGING_FOLDER, UUIDUtilities.generate());
        try {
            await this.writeFile(partial, data);
            await this.replace(partial, target);
        }
        catch (error) {
            await this.unlink(partial);
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        const target: string = this.resolvePath(key);
        let stats: Stats | undefined;
        try {
            stats = await this.findStats(target);
        }
        catch (error) {
            throw this.isPermissionDenied(error) ? new BackupKeyAccessDeniedError(this.storeName, key, error) : error;
        }
        if (stats == undefined) {
            throw new BackupKeyNotFoundError(this.storeName, key);
        }
        if (stats.size > maxBytes) {
            throw new InternalError(`"${this.options.host}:${target}" is ${stats.size} bytes, larger than the ${maxBytes} it may be.`);
        }
        const file: ReadStream = this.sftp.createReadStream(target);
        // what reads the file decides when the next READ is sent, so a slow restore is no wait for the server
        const askedId: number = this.ask(`READ of "${target}"`, false);
        file.once('close', () => this.asked.delete(askedId));
        // counted while it arrives as well: the size is what the server says, which can send more than it
        // said, for as long as it likes, and the file can have grown since
        let received: number = 0;
        const data: Transform = new Transform({
            transform: (chunk: Buffer, _encoding: BufferEncoding, next: TransformCallback): void => {
                received += chunk.length;
                if (received > maxBytes) {
                    next(new InternalError(`"${this.options.host}:${target}" is larger than the ${maxBytes} bytes it may be.`));
                    return;
                }
                next(undefined, chunk);
            }
        });
        // wired by hand rather than with pipeline, which destroys the file with an error when the reader
        // stops early: ssh2's stream does not emit close after one, and close() waits for it
        // the file is opened once it is read, so a file the server lets be found and not read fails here
        file.on('error', (error: Error) => {
            data.destroy(this.isPermissionDenied(error) ? new BackupKeyAccessDeniedError(this.storeName, key, error) : error);
        });
        // the file is closed on the server however the reading ends: to its end, refused, or stopped
        data.once('close', () => {
            if (!file.readableEnded) {
                file.destroy();
            }
        });
        file.pipe(data);
        this.reading.set(file, data);
        file.once('close', () => this.reading.delete(file));
        return data;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        let page: string[] = [];
        // from the folder the prefix names rather than from the top, so that listing one part of the
        // store does not walk all of it
        const folder: string | undefined = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : undefined;
        for await (const key of this.walk(folder)) {
            if (!key.startsWith(prefix)) {
                continue;
            }
            page.push(key);
            if (page.length >= PAGE_SIZE) {
                yield page;
                page = [];
            }
        }
        if (page.length) {
            yield page;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findNames(keyPath: string): AsyncIterable<string[]> {
        const names: string[] = (await this.findEntries(keyPath === '' ? this.options.path : this.resolvePath(keyPath)))
            .filter(entry => !entry.filename.endsWith(PARTIAL_SUFFIX))
            .map(entry => entry.filename);
        for (let i: number = 0; i < names.length; i += PAGE_SIZE) {
            yield names.slice(i, i + PAGE_SIZE);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await Promise.all(keys.map(async key => await this.unlink(this.resolvePath(key))));
        // the folders a key was in go with their last key: a backup's folder left behind empty would be
        // read as a backup that was interrupted, and warned about on every sync. The deepest first
        const folders: string[] = [
            ...new Set(keys.flatMap(key => {
                const segments: string[] = resolveBackupKeySegments(this.storeName, key).slice(0, -1);
                return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
            }))
        ].sort((a, b) => b.split('/').length - a.split('/').length);
        for (const folder of folders) {
            await this.removeDirectoryIfEmpty(path.posix.join(this.options.path, folder));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async close(): Promise<void> {
        // a stream of `get` closes its file on the server after it handed over the last of it. Ending the
        // connection before the server answered failed that request, and the stream emitted the error once
        // nobody listened to it any more, which ended the process
        await Promise.all([...this.reading].map(async ([file, data]) => {
            const closed: Promise<void> = new Promise(resolve => file.once('close', () => resolve()));
            if (!file.readableEnded) {
                data.destroy();
                file.destroy();
            }
            // a connection that ended answers no CLOSE any more, and took the file with it
            await this.wait(closed).catch(() => undefined);
        }));
        this.client.end();
    }

    /**
     * Fails whatever waits for an answer, and every file being read, once the connection ended.
     * @param error - Why.
     */
    private end(error: Error): void {
        if (this.ended != undefined) {
            return;
        }
        this.ended = error;
        clearInterval(this.answersChecked);
        for (const fail of this.waiting) {
            fail(error);
        }
        this.waiting.clear();
        for (const [file, data] of this.reading) {
            // a file read to its end left all of itself to its reader already
            if (!file.readableEnded) {
                data.destroy(error);
            }
        }
    }

    /**
     * Ends the connection once the server answered none of the requests waiting for their answer for as long as
     * it may, failing whatever waits with what it waited for. A request answered counts for every one still
     * waiting, so that the last of the writes a put keeps in flight waits for those before it. A session waiting
     * for the server while ssh2 waits for no answer, such as for a file to close that it never asks the server
     * to, counts as one the server answers nothing.
     * @param timeoutMs - How long the server may answer nothing.
     */
    private checkAnswers(timeoutMs: number): void {
        const pending: Set<string> = new Set(this.findPendingRequestIds());
        const awaitsServer: boolean = [...this.asked.values()].some(asked => asked.awaitsServer);
        const now: number = performance.now();
        const answered: boolean = [...this.pendingAtLastCheck].some(id => !pending.has(id));
        if (answered || (pending.size === 0 && !awaitsServer)) {
            this.lastAnsweredAt = now;
        }
        this.pendingAtLastCheck = pending;
        if (now - this.lastAnsweredAt < timeoutMs) {
            return;
        }
        const asked: string = [...this.asked.values()].map(request => request.what).join(', ') || 'a request ssh2 sent by itself';
        this.end(new InternalError(
            `The server "${this.options.host}" answered nothing the transport "${this.storeName}" asked for within `
            + `${timeoutMs} ms: ${asked}. Its connection was ended.`
        ));
        this.client.end();
    }

    /**
     * The ids of ssh2's requests of the session that wait for their answer.
     * @returns The ids.
     * @throws An InternalError when ssh2 no longer keeps them in `_requests`.
     */
    private findPendingRequestIds(): string[] {
        // no public way to tell: a stream sends its requests by itself, and only while it is not waiting for
        // what reads or writes it, which is how a slow restore is told from a server that stopped answering
        const requests: unknown = Reflect.get(this.sftp, '_requests');
        if (typeof requests !== 'object' || requests == null) {
            throw new InternalError(
                'ssh2 no longer keeps the requests of an SFTP session waiting for their answer in _requests, which the '
                + `transport "${this.storeName}" tells a server that stopped answering by. Install ssh2 ^1.17.0, which zibri names.`
            );
        }
        return Object.keys(requests);
    }

    /**
     * Notes what the session waits for an answer to, for the error naming it.
     * @param what - The request, such as `REMOVE of "/backups/a"`.
     * @param awaitsServer - Whether the session waits for the server from now on.
     * @returns The id to remove it by once it was answered.
     */
    private ask(what: string, awaitsServer: boolean): number {
        const id: number = this.askedCount++;
        this.asked.set(id, { what, awaitsServer });
        return id;
    }

    /**
     * Sends a request, and waits for its answer for as long as the connection is there.
     * @param operation - The request, as the protocol names it, such as `REMOVE`.
     * @param filePath - The path it is about.
     * @param send - Sends it, settling with its answer.
     * @returns The answer.
     */
    private async request<T>(
        operation: string,
        filePath: string,
        send: (resolve: (value: T) => void, reject: (error: Error) => void) => void
    ): Promise<T> {
        if (this.ended != undefined) {
            throw this.ended;
        }
        const askedId: number = this.ask(`${operation} of "${filePath}"`, true);
        try {
            return await this.wait(new Promise<T>(send));
        }
        finally {
            this.asked.delete(askedId);
        }
    }

    /**
     * Waits for work on the connection for as long as the connection is there.
     * @param work - The work.
     * @returns What it settled with.
     */
    private async wait<T>(work: Promise<T>): Promise<T> {
        if (this.ended != undefined) {
            // settles never, or with what is not asked for any more. Only its rejection is marked as handled
            // here, an await would wait for work that may never settle
            // eslint-disable-next-line promise/prefer-await-to-then
            work.catch(() => undefined);
            throw this.ended;
        }
        return await new Promise<T>((resolve, reject) => {
            this.waiting.add(reject);
            work.then(
                value => {
                    this.waiting.delete(reject);
                    resolve(value);
                },
                (error: unknown) => {
                    this.waiting.delete(reject);
                    reject(error);
                }
            );
        });
    }

    private async* walk(relative: string | undefined): AsyncGenerator<string> {
        const entries: FileEntryWithStats[] = await this.findEntries(
            relative == undefined ? this.options.path : this.resolvePath(relative)
        );
        for (const entry of entries) {
            const key: string = relative == undefined ? entry.filename : `${relative}/${entry.filename}`;
            if (entry.filename.endsWith(PARTIAL_SUFFIX)) {
                continue;
            }
            if (entry.attrs.isDirectory()) {
                yield* this.walk(key);
            }
            else {
                yield key;
            }
        }
    }

    /**
     * Creates the staging folder, and deletes what puts that ended without removing it left there.
     */
    private async prepareStagingFolder(): Promise<void> {
        const staging: string = path.posix.join(this.options.path, STAGING_FOLDER);
        // in seconds, as the protocol carries when a file was written
        const cutoff: number = (Date.now() - STAGED_FILE_LIFETIME_MS) / Ms.SECOND;
        const leftBehind: FileEntryWithStats[] = (await this.findEntries(staging)).filter(entry => entry.attrs.mtime < cutoff);
        await Promise.all(leftBehind.map(async entry => await this.unlink(path.posix.join(staging, entry.filename))));
        await this.createDirectory(staging);
    }

    private async writeFile(filePath: string, data: Readable): Promise<void> {
        // ssh2's stream keeps one WRITE in flight, and sends at once only what buffered while one was
        // pending. With its default buffer of about one chunk every packet waited a round trip of its
        // own, which stored at a tenth of the speed a fetch reads at
        const target: WriteStream = this.sftp.createWriteStream(filePath, { highWaterMark: WRITE_BUFFER_BYTES });
        // on `close` rather than on `finish`, which the stream emits once the last write is acknowledged and
        // before it asked the server to close the file. The file is renamed right after this returns
        const closed: Promise<void> = new Promise((resolve, reject) => {
            target.once('close', () => resolve());
            target.once('error', reject);
        });
        // the data decides when the next WRITE is sent, as a dump can take its time; once it ended, all that is left
        // is the server acknowledging the writes and closing the file
        const what: string = `WRITE of "${filePath}"`;
        const askedId: number = this.ask(what, false);
        data.once('end', () => {
            if (this.asked.has(askedId)) {
                this.asked.set(askedId, { what, awaitsServer: true });
            }
        });
        try {
            await this.wait(Promise.all([pipeline(data, target), closed]));
        }
        catch (error) {
            // as the pipeline does when it fails, which it never does once the connection ended under it
            data.destroy();
            throw error;
        }
        finally {
            this.asked.delete(askedId);
        }
    }

    private async replace(from: string, to: string): Promise<void> {
        // the rename of the protocol refuses a target that exists, and a put replaces what the key held.
        // OpenSSH's own replaces it at one moment; a server without it gets the target removed first
        const announced: boolean = await this.request<boolean>('RENAME', from, (resolve, reject) => {
            try {
                this.sftp.ext_openssh_rename(from, to, error => error == undefined ? resolve(true) : reject(error));
            }
            catch {
                // what ssh2 does, sending nothing, for a server that did not announce the extension. One that
                // did and refuses answers with an error, which fails the put and leaves the target as it is:
                // it can refuse for any reason, and removing the target first then lost what the key held
                resolve(false);
            }
        });
        if (announced) {
            return;
        }
        await this.unlink(to);
        await this.request<void>('RENAME', from, (resolve, reject) => {
            this.sftp.rename(from, to, error => error == undefined ? resolve() : reject(error));
        });
    }

    private async createDirectory(directory: string): Promise<void> {
        if ((await this.findStats(directory))?.isDirectory() == true) {
            return;
        }
        const parent: string = path.posix.dirname(directory);
        if (parent !== directory) {
            await this.createDirectory(parent);
        }
        try {
            await this.request<void>('MKDIR', directory, (resolve, reject) => {
                this.sftp.mkdir(directory, error => error == undefined ? resolve() : reject(error));
            });
        }
        catch (error) {
            // the resources of one backup are stored at the same time, each over a connection of its own, so
            // another one can have created it in between
            if ((await this.findStats(directory))?.isDirectory() == true) {
                return;
            }
            throw error;
        }
    }

    private async removeDirectoryIfEmpty(directory: string): Promise<void> {
        if ((await this.findEntries(directory)).length) {
            return;
        }
        await this.request<void>('RMDIR', directory, (resolve, reject) => {
            this.sftp.rmdir(directory, error => {
                // the resources of one backup are deleted at the same time, so another one can have removed it
                if (error == undefined || this.isNoSuchFile(error)) {
                    resolve();
                    return;
                }
                reject(error);
            });
        });
    }

    private async findEntries(directory: string): Promise<FileEntryWithStats[]> {
        return await this.request<FileEntryWithStats[]>('READDIR', directory, (resolve, reject) => {
            this.sftp.readdir(directory, (error, entries) => {
                if (error == undefined) {
                    resolve(entries);
                    return;
                }
                // a folder nothing was stored in yet holds no keys
                if (this.isNoSuchFile(error)) {
                    resolve([]);
                    return;
                }
                reject(error);
            });
        });
    }

    private async findStats(filePath: string): Promise<Stats | undefined> {
        return await this.request<Stats | undefined>('STAT', filePath, (resolve, reject) => {
            this.sftp.stat(filePath, (error, stats) => {
                if (error == undefined) {
                    resolve(stats);
                    return;
                }
                if (this.isNoSuchFile(error)) {
                    resolve(undefined);
                    return;
                }
                reject(error);
            });
        });
    }

    private async unlink(filePath: string): Promise<void> {
        await this.request<void>('REMOVE', filePath, (resolve, reject) => {
            this.sftp.unlink(filePath, error => {
                // what a delete is for is already true, which is what a delete that is run again after being
                // interrupted finds
                if (error == undefined || this.isNoSuchFile(error)) {
                    resolve();
                    return;
                }
                reject(error);
            });
        });
    }

    private isNoSuchFile(error: Error): boolean {
        return 'code' in error && error.code === NO_SUCH_FILE;
    }

    private isPermissionDenied(error: unknown): boolean {
        return error instanceof Error && 'code' in error && error.code === PERMISSION_DENIED;
    }

    private resolvePath(key: string): string {
        return path.posix.join(this.options.path, ...resolveBackupKeySegments(this.storeName, key));
    }
}