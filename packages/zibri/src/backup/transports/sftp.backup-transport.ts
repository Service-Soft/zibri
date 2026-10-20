import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Client, ConnectConfig, FileEntryWithStats, SFTPWrapper, Stats, WriteStream } from 'ssh2';

import { BackupTransportInterface } from './backup-transport.interface.ts';
import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { BackupEntity } from '../backup-entity.model.ts';
import { BackupResourceEntity } from '../backup-resource-entity.model.ts';

const METADATA_FILENAME: string = 'metadata.json';
// the record is written under this name and renamed once it is complete: the record is what makes a backup
// finished, so one that was cut off while it was written must not look like one
const PARTIAL_SUFFIX: string = '.partial';
const FINGERPRINT_PREFIX: string = 'SHA256:';

const DEFAULT_PORT: number = 22;
const DEFAULT_CONNECT_TIMEOUT_MS: number = Ms.SECOND * 20;
// a server that stops answering would otherwise leave a backup waiting forever, since nothing on the
// connection has a timeout of its own. Three unanswered keepalive packets end it, which fails whatever was in flight
const KEEPALIVE_INTERVAL_MS: number = Ms.SECOND * 15;
const KEEPALIVE_COUNT_MAX: number = 3;
// the record of a backup names it and its resources, which is far below this
const MAX_METADATA_SIZE: FileSize = '10mb';
// what the protocol answers for a path that does not exist, SSH_FX_NO_SUCH_FILE
const NO_SUCH_FILE: number = 2;

/**
 * An open connection to the server, and the file transfer session on it.
 */
type SftpSession = {
    /**
     * The connection, which is ended when the session is done.
     */
    client: Client,
    /**
     * The file transfer session.
     */
    sftp: SFTPWrapper
};

/**
 * A transport that stores backups in a folder on a server reached over SFTP.
 *
 * Each resource is stored as the file `<path>/<backup name>/<resource name>`, and the record of the backup as
 * `<path>/<backup name>/metadata.json` beside it. Needs the optional peer dependency `ssh2`.
 */
export abstract class BaseSftpBackupTransport implements BackupTransportInterface {
    abstract readonly name: string;
    protected abstract readonly options: SftpBackupTransportOptions;

    constructor() {
        // when the transport is built rather than at the first backup, which can be days after the
        // deployment that left the package out
        optionalPeer('ssh2', 'The sftp backup transport');
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveBackups(existingNames: string[]): Promise<string[]> {
        return await this.withSession(async sftp => {
            const entries: FileEntryWithStats[] = await this.findEntries(sftp, this.options.path);
            const documents: (string | undefined)[] = await Promise.all(entries.map(async entry => {
                if (!entry.attrs.isDirectory() || existingNames.includes(entry.filename)) {
                    return;
                }
                const metadataPath: string = this.resolveMetadataPath(entry.filename);
                const stats: Stats | undefined = await this.findStats(sftp, metadataPath);
                if (stats == undefined) {
                    // a folder holding data and no record is a backup that was interrupted before it
                    // finished: the record is the last thing written, precisely so that this is what a
                    // half-finished one looks like from here
                    this.logger.warn(
                        `Could not find the metadata needed to resolve the backup "${entry.filename}" `
                        + `at "${this.options.host}:${this.options.path}"`
                    );
                    return;
                }
                if (fileSizeToBytes(MAX_METADATA_SIZE).isLessThan(stats.size)) {
                    throw new InternalError(
                        `"${metadataPath}" on "${this.options.host}" is larger than ${MAX_METADATA_SIZE}, which no record of a backup is.`
                    );
                }
                return await this.readText(sftp, metadataPath);
            }));
            return documents.filter(d => d != undefined);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await this.withSession(async sftp => {
            await this.createDirectory(sftp, this.resolveBackupPath(backup.name));
            await this.writeFile(sftp, this.resolveResourcePath(backup, resource), data);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async storeMetadata(backup: BackupEntity, document: string): Promise<void> {
        await this.withSession(async sftp => {
            const metadataPath: string = this.resolveMetadataPath(backup.name);
            await this.createDirectory(sftp, this.resolveBackupPath(backup.name));
            await this.writeFile(sftp, `${metadataPath}${PARTIAL_SUFFIX}`, Readable.from([Buffer.from(document)]));
            await this.rename(sftp, `${metadataPath}${PARTIAL_SUFFIX}`, metadataPath);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Promise<Readable> {
        if (resource.size == undefined) {
            throw new InternalError(`The backup "${backup.name}" recorded no size for "${resource.name}", so it cannot be retrieved.`);
        }
        const session: SftpSession = await this.openSession();
        try {
            const resourcePath: string = this.resolveResourcePath(backup, resource);
            const stats: Stats | undefined = await this.findStats(session.sftp, resourcePath);
            if (stats == undefined) {
                throw new InternalError(
                    `The backup "${backup.name}" holds no data for "${resource.name}" at "${this.options.host}:${resourcePath}".`
                );
            }
            // no larger than what was stored: a file that has grown since is refused before any of it is
            // read, rather than after it was written to disk in full
            if (stats.size > resource.size) {
                throw new InternalError(
                    `"${this.options.host}:${resourcePath}" is ${stats.size} bytes, larger than the ${resource.size} recorded for it.`
                );
            }
            const data: Readable = session.sftp.createReadStream(resourcePath);
            // the connection belongs to the stream from here on. On `close`, which the stream emits once the
            // server closed the file, rather than on `end`
            const end: () => void = () => session.client.end();
            data.once('close', end);
            data.once('error', end);
            return data;
        }
        catch (error) {
            session.client.end();
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await this.withSession(async sftp => {
            await this.unlink(sftp, this.resolveResourcePath(backup, resource));
            // the record went first, so the last resource to go empties the folder. Left behind, it would be
            // resolved as a backup that was interrupted, and warned about on every sync
            await this.removeDirectoryIfEmpty(sftp, this.resolveBackupPath(backup.name));
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteMetadata(backup: BackupEntity): Promise<void> {
        await this.withSession(async sftp => {
            await this.unlink(sftp, this.resolveMetadataPath(backup.name));
        });
    }

    private async withSession<T>(work: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
        const session: SftpSession = await this.openSession();
        try {
            return await work(session.sftp);
        }
        finally {
            session.client.end();
        }
    }

    private async openSession(): Promise<SftpSession> {
        this.validateHostKeyFingerprint();
        const { Client: SshClient } = optionalPeer<typeof import('ssh2')>('ssh2', 'The sftp backup transport');
        const client: Client = new SshClient();

        let presentedKey: Buffer | undefined;
        const config: ConnectConfig = {
            host: this.options.host,
            port: this.options.port ?? DEFAULT_PORT,
            username: this.options.username,
            ...this.options.authentication,
            readyTimeout: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
            keepaliveInterval: KEEPALIVE_INTERVAL_MS,
            keepaliveCountMax: KEEPALIVE_COUNT_MAX,
            hostVerifier: (key: Buffer): boolean => {
                presentedKey = key;
                return this.resolveFingerprint(key) === this.options.hostKeyFingerprint;
            }
        };

        let sftp: SFTPWrapper;
        try {
            sftp = await new Promise((resolve, reject) => {
                client.once('error', reject);
                client.once('ready', () => {
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
        // an error once the connection is up fails whatever is in flight on it by itself. Listened for, so
        // that it is not thrown at the process as an unhandled event
        client.on('error', error => {
            this.logger.warn(`The connection of the transport "${this.name}" to "${this.options.host}" failed: ${error.message}`);
        });
        return { client, sftp };
    }

    private async writeFile(sftp: SFTPWrapper, filePath: string, data: Readable): Promise<void> {
        const target: WriteStream = sftp.createWriteStream(filePath);
        // on `close` rather than on `finish`, which the stream emits once the last write is acknowledged and
        // before it asked the server to close the file. The connection is ended right after this returns
        const closed: Promise<void> = new Promise((resolve, reject) => {
            target.once('close', () => resolve());
            target.once('error', reject);
        });
        await Promise.all([pipeline(data, target), closed]);
    }

    private async readText(sftp: SFTPWrapper, filePath: string): Promise<string> {
        // rather than through a read stream, which ends before it asked the server to close the file: the
        // session is ended right after this returns, and the close still in flight then fails on a stream
        // nobody listens to any more. This one calls back once the file is closed
        const content: Buffer = await new Promise((resolve, reject) => {
            sftp.readFile(filePath, (error, data) => error == undefined ? resolve(data) : reject(error));
        });
        // as text: the record is handed back as it was stored, never parsed here
        return content.toString('utf8');
    }

    private async createDirectory(sftp: SFTPWrapper, directory: string): Promise<void> {
        if ((await this.findStats(sftp, directory))?.isDirectory() == true) {
            return;
        }
        const parent: string = path.posix.dirname(directory);
        if (parent !== directory) {
            await this.createDirectory(sftp, parent);
        }
        try {
            await new Promise<void>((resolve, reject) => {
                sftp.mkdir(directory, error => error == undefined ? resolve() : reject(error));
            });
        }
        catch (error) {
            // the resources of one backup are stored at the same time, each over a connection of its own, so
            // another one can have created it in between
            if ((await this.findStats(sftp, directory))?.isDirectory() == true) {
                return;
            }
            throw error;
        }
    }

    private async removeDirectoryIfEmpty(sftp: SFTPWrapper, directory: string): Promise<void> {
        if ((await this.findEntries(sftp, directory)).length) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            sftp.rmdir(directory, error => {
                // the resources of one backup are deleted at the same time, so another one can have removed it
                if (error == undefined || this.isNoSuchFile(error)) {
                    resolve();
                    return;
                }
                reject(error);
            });
        });
    }

    private async findEntries(sftp: SFTPWrapper, directory: string): Promise<FileEntryWithStats[]> {
        return await new Promise((resolve, reject) => {
            sftp.readdir(directory, (error, entries) => {
                if (error == undefined) {
                    resolve(entries);
                    return;
                }
                // a folder nothing was stored in yet holds no backups
                if (this.isNoSuchFile(error)) {
                    resolve([]);
                    return;
                }
                reject(error);
            });
        });
    }

    private async findStats(sftp: SFTPWrapper, filePath: string): Promise<Stats | undefined> {
        return await new Promise((resolve, reject) => {
            sftp.stat(filePath, (error, stats) => {
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

    private async rename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            sftp.rename(from, to, error => error == undefined ? resolve() : reject(error));
        });
    }

    private async unlink(sftp: SFTPWrapper, filePath: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            sftp.unlink(filePath, error => {
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

    private resolveBackupPath(backupName: string): string {
        return path.posix.join(this.options.path, backupName);
    }

    private resolveResourcePath(backup: BackupEntity, resource: BackupResourceEntity): string {
        return path.posix.join(this.resolveBackupPath(backup.name), resource.name);
    }

    private resolveMetadataPath(backupName: string): string {
        return path.posix.join(this.resolveBackupPath(backupName), METADATA_FILENAME);
    }
}