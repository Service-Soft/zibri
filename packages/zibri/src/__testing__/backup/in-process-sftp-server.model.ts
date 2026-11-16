import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { AddressInfo } from 'node:net';
import { posix } from 'node:path';

import { Attributes, Connection, FileEntry, ParsedKey, Server, SFTPWrapper, utils } from 'ssh2';

import { SftpBackupTransportOptions } from '../../backup/transports/sftp/sftp-backup-transport-options.model';

const USERNAME: string = 'zibri';
const PASSWORD: string = 'zibri-test-password';

/**
 * The VERSION packet ssh2's server answers every client with: version 3, and no extensions.
 */
const PLAIN_VERSION_PACKET: Buffer = Buffer.from([0, 0, 0, 5, 2, 0, 0, 0, 3]);

/**
 * The request a server answers, and the connection it came in on.
 */
export type InProcessSftpRequest = {
    /**
     * The session the request came in on, which answers it.
     */
    sftp: SFTPWrapper,
    /**
     * The connection the session is on.
     */
    connection: Connection,
    /**
     * The id the answer is sent with.
     */
    reqId: number
};

/**
 * An SFTP server of ssh2's own in the test's process, for the suites that check what the SFTP blob store
 * does where no container runs. It keeps its directories and files in memory, written at their offsets,
 * and logs in one user with a password.
 *
 * Each request is answered by a method of its own, which a suite overrides to answer differently: slower,
 * wrongly, or not at all.
 */
export class InProcessSftpServer {
    /**
     * Each file, by its path.
     */
    readonly files: Map<string, Buffer> = new Map();

    /**
     * Each directory, by its path.
     */
    readonly directories: Set<string> = new Set(['/']);

    /**
     * When each file was last written, by its path, in seconds since the epoch as the protocol carries it.
     */
    readonly modifiedAt: Map<string, number> = new Map();

    private readonly hostKey: utils.KeyPairReturn = utils.generateKeyPairSync('ecdsa', { bits: 256 });
    private readonly connections: Set<Connection> = new Set();
    // the path each handle that was handed out was opened for
    private readonly handles: Map<string, string> = new Map();
    // the handles of directories whose entries were handed out already, which the next READDIR ends
    private readonly listed: Set<string> = new Set();
    private server: Server | undefined;
    private port: number = 0;

    /**
     * Creates the server, which starts once {@link start} is called.
     * @param announcedExtensions - The extensions the server announces to a client, by name, with the
     * value each is announced with. Announced and not answered unless {@link answerExtended} answers them.
     */
    constructor(private readonly announcedExtensions: Record<string, string> = {}) {}

    /**
     * Starts the server on a free port of this machine.
     */
    async start(): Promise<void> {
        const server: Server = new Server(
            { hostKeys: [this.hostKey.private] },
            (connection: Connection) => this.serveConnection(connection)
        );
        this.server = server;
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address: string | AddressInfo | null = server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The sftp server listens on no port.');
        }
        this.port = address.port;
    }

    /**
     * Stops the server, ending every connection to it.
     */
    async stop(): Promise<void> {
        this.endConnections();
        const server: Server | undefined = this.server;
        await new Promise<void>(resolve => server == undefined ? resolve() : server.close(() => resolve()));
    }

    /**
     * Ends every connection to the server from its side, as a server that goes away does.
     */
    endConnections(): void {
        for (const connection of this.connections) {
            connection.end();
        }
        this.connections.clear();
    }

    /**
     * The options of a transport reaching the server, once it was started.
     * @param path - The folder the transport keeps its blobs in.
     * @returns The options.
     */
    getOptions(path: string): SftpBackupTransportOptions {
        return {
            host: '127.0.0.1',
            port: this.port,
            username: USERNAME,
            authentication: { password: PASSWORD },
            hostKeyFingerprint: this.resolveHostKeyFingerprint(),
            path
        };
    }

    /**
     * Answers a STAT: the directory or the file at a path, or that there is none.
     * @param request - The request.
     * @param path - The path.
     */
    protected answerStat(request: InProcessSftpRequest, path: string): void {
        const attributes: Attributes | undefined = this.findAttributes(path);
        if (attributes == undefined) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
            return;
        }
        request.sftp.attrs(request.reqId, attributes);
    }

    /**
     * Answers an OPENDIR with a handle, or that there is no such directory.
     * @param request - The request.
     * @param path - The directory.
     */
    protected answerOpenDirectory(request: InProcessSftpRequest, path: string): void {
        if (!this.directories.has(path)) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
            return;
        }
        const handle: Buffer = randomBytes(4);
        this.handles.set(handle.toString('hex'), path);
        request.sftp.handle(request.reqId, handle);
    }

    /**
     * Answers the first READDIR of a handle with every entry directly in its directory, and the next with the end.
     * @param request - The request.
     * @param handle - The handle, in hex.
     * @param path - The directory the handle was opened for.
     */
    protected answerReadDirectory(request: InProcessSftpRequest, handle: string, path: string): void {
        if (this.listed.has(handle)) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.EOF);
            return;
        }
        this.listed.add(handle);
        const entries: FileEntry[] = [...this.directories, ...this.files.keys()]
            .filter(entry => entry !== path && posix.dirname(entry) === path)
            .flatMap(entry => {
                const attrs: Attributes | undefined = this.findAttributes(entry);
                return attrs == undefined ? [] : [{ filename: posix.basename(entry), longname: posix.basename(entry), attrs }];
            });
        request.sftp.name(request.reqId, entries);
    }

    /**
     * Answers a MKDIR.
     * @param request - The request.
     * @param path - The directory.
     */
    protected answerMkdir(request: InProcessSftpRequest, path: string): void {
        this.directories.add(path);
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
    }

    /**
     * Answers an OPEN with a handle. A file opened to be written is emptied, one opened to be read stays as it is.
     * @param request - The request.
     * @param path - The file.
     * @param flags - What it is opened for.
     */
    protected answerOpen(request: InProcessSftpRequest, path: string, flags: number): void {
        const handle: Buffer = randomBytes(4);
        this.handles.set(handle.toString('hex'), path);
        if ((flags & utils.sftp.OPEN_MODE.WRITE) !== 0) {
            this.files.set(path, Buffer.alloc(0));
            this.modifiedAt.set(path, this.resolveNow());
        }
        request.sftp.handle(request.reqId, handle);
    }

    /**
     * Answers a READ with the bytes of the file at an offset, or with the end of it.
     * @param request - The request.
     * @param path - The file the handle was opened for.
     * @param offset - Where the read starts.
     * @param length - How many bytes it asks for at most.
     */
    protected answerRead(request: InProcessSftpRequest, path: string, offset: number, length: number): void {
        const file: Buffer = this.files.get(path) ?? Buffer.alloc(0);
        if (offset >= file.length) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.EOF);
            return;
        }
        request.sftp.data(request.reqId, file.subarray(offset, offset + length));
    }

    /**
     * Answers a WRITE, having written the data into the file at its offset.
     * @param request - The request.
     * @param path - The file the handle was opened for.
     * @param offset - Where the data goes.
     * @param data - The data.
     */
    protected answerWrite(request: InProcessSftpRequest, path: string, offset: number, data: Buffer): void {
        this.writeAt(path, offset, data);
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
    }

    /**
     * Answers a CLOSE.
     * @param request - The request.
     */
    protected answerClose(request: InProcessSftpRequest): void {
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
    }

    /**
     * Answers a REMOVE.
     * @param request - The request.
     * @param path - The file.
     */
    protected answerRemove(request: InProcessSftpRequest, path: string): void {
        this.modifiedAt.delete(path);
        request.sftp.status(request.reqId, this.files.delete(path) ? utils.sftp.STATUS_CODE.OK : utils.sftp.STATUS_CODE.NO_SUCH_FILE);
    }

    /**
     * Answers a RENAME as the protocol has it, refusing a target that exists.
     * @param request - The request.
     * @param from - The file.
     * @param to - Where it goes.
     */
    protected answerRename(request: InProcessSftpRequest, from: string, to: string): void {
        const file: Buffer | undefined = this.files.get(from);
        if (file == undefined || this.files.has(to)) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.FAILURE);
            return;
        }
        this.move(from, to, file);
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
    }

    /**
     * Answers an extended request: OpenSSH's posix rename, which replaces a target that exists, and no other.
     * @param request - The request.
     * @param name - The name of the extension.
     * @param data - What the request carries.
     */
    protected answerExtended(request: InProcessSftpRequest, name: string, data: Buffer): void {
        if (name !== 'posix-rename@openssh.com') {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OP_UNSUPPORTED);
            return;
        }
        const [from, to] = this.readStrings(data, 2);
        const file: Buffer | undefined = this.files.get(from ?? '');
        if (from == undefined || file == undefined || to == undefined) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
            return;
        }
        this.move(from, to, file);
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
    }

    /**
     * Answers a client asking for the SFTP subsystem, by opening a session for it.
     * @param acceptSftp - Opens the session.
     * @param connection - The connection it is asked on.
     */
    protected answerSftpRequest(acceptSftp: () => SFTPWrapper, connection: Connection): void {
        this.serveSftp(acceptSftp(), connection);
    }

    private move(from: string, to: string, file: Buffer): void {
        this.files.set(to, file);
        this.files.delete(from);
        this.modifiedAt.set(to, this.modifiedAt.get(from) ?? this.resolveNow());
        this.modifiedAt.delete(from);
    }

    private findAttributes(path: string): Attributes | undefined {
        if (this.directories.has(path)) {
            return { mode: constants.S_IFDIR | 0o755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };
        }
        const file: Buffer | undefined = this.files.get(path);
        if (file == undefined) {
            return undefined;
        }
        const modifiedAt: number = this.modifiedAt.get(path) ?? 0;
        return { mode: constants.S_IFREG | 0o644, uid: 0, gid: 0, size: file.length, atime: modifiedAt, mtime: modifiedAt };
    }

    private resolveNow(): number {
        return Math.floor(Date.now() / 1000);
    }

    private serveConnection(connection: Connection): void {
        this.connections.add(connection);
        connection.once('close', () => this.connections.delete(connection));
        // a client the server ends the connection of reports it; nothing to do about it here
        connection.on('error', () => undefined);
        connection.on('authentication', context => {
            if (context.method === 'password' && context.username === USERNAME && context.password === PASSWORD) {
                context.accept();
                return;
            }
            context.reject(['password']);
        });
        connection.on('ready', () => {
            connection.on('session', accept => {
                accept().on('sftp', acceptSftp => this.answerSftpRequest(acceptSftp, connection));
            });
        });
    }

    private serveSftp(sftp: SFTPWrapper, connection: Connection): void {
        this.announceExtensions(sftp);
        const request: (reqId: number) => InProcessSftpRequest = reqId => ({ sftp, connection, reqId });
        const pathOf: (handle: Buffer) => string = handle => this.handles.get(handle.toString('hex')) ?? '';
        sftp.on('STAT', (reqId: number, path: string) => this.answerStat(request(reqId), path));
        sftp.on('MKDIR', (reqId: number, path: string) => this.answerMkdir(request(reqId), path));
        sftp.on('OPEN', (reqId: number, path: string, flags: number) => this.answerOpen(request(reqId), path, flags));
        sftp.on('READ', (reqId: number, handle: Buffer, offset: number, length: number) => {
            this.answerRead(request(reqId), pathOf(handle), offset, length);
        });
        sftp.on('WRITE', (reqId: number, handle: Buffer, offset: number, data: Buffer) => {
            this.answerWrite(request(reqId), pathOf(handle), offset, data);
        });
        sftp.on('OPENDIR', (reqId: number, path: string) => this.answerOpenDirectory(request(reqId), path));
        sftp.on('READDIR', (reqId: number, handle: Buffer) => {
            this.answerReadDirectory(request(reqId), handle.toString('hex'), pathOf(handle));
        });
        sftp.on('CLOSE', (reqId: number, handle: Buffer) => {
            this.handles.delete(handle.toString('hex'));
            this.listed.delete(handle.toString('hex'));
            this.answerClose(request(reqId));
        });
        sftp.on('REMOVE', (reqId: number, path: string) => this.answerRemove(request(reqId), path));
        sftp.on('RENAME', (reqId: number, from: string, to: string) => this.answerRename(request(reqId), from, to));
        sftp.on('EXTENDED', (reqId: number, name: string, data: Buffer) => this.answerExtended(request(reqId), name, data));
    }

    /**
     * Has the session announce the extensions the server was given.
     *
     * Ssh2's server announces none, and has no option to: its VERSION packet is a constant. A client uses
     * an extension only on a server that announced it, so the one packet is swapped for one naming them
     * where the session hands its packets to the connection. Throws rather than announcing nothing once
     * ssh2 sends them another way, so that a suite relying on an extension fails for that reason.
     * @param sftp - The session, before the client asked it for its version.
     * @throws When ssh2 no longer hands the packets of a session to its connection through `_protocol.channelData`.
     */
    private announceExtensions(sftp: SFTPWrapper): void {
        if (!Object.keys(this.announcedExtensions).length) {
            return;
        }
        const protocol: unknown = Reflect.get(sftp, '_protocol');
        const channelData: unknown = typeof protocol === 'object' && protocol != null ? Reflect.get(protocol, 'channelData') : undefined;
        if (typeof protocol !== 'object' || protocol == null || typeof channelData !== 'function') {
            throw new Error('ssh2 no longer hands the packets of a session to its connection through _protocol.channelData.');
        }
        const announcing: Buffer = this.resolveVersionPacket();
        Reflect.set(protocol, 'channelData', (channel: number, data: Buffer) => {
            Reflect.apply(channelData, protocol, [channel, data.equals(PLAIN_VERSION_PACKET) ? announcing : data]);
        });
    }

    private resolveVersionPacket(): Buffer {
        const body: Buffer = Buffer.concat([
            Buffer.from([2, 0, 0, 0, 3]),
            ...Object.entries(this.announcedExtensions).flatMap(([name, value]) => [this.writeString(name), this.writeString(value)])
        ]);
        const length: Buffer = Buffer.alloc(4);
        length.writeUInt32BE(body.length);
        return Buffer.concat([length, body]);
    }

    private writeString(value: string): Buffer {
        const length: Buffer = Buffer.alloc(4);
        length.writeUInt32BE(Buffer.byteLength(value));
        return Buffer.concat([length, Buffer.from(value)]);
    }

    private readStrings(data: Buffer, count: number): (string | undefined)[] {
        const strings: (string | undefined)[] = [];
        let offset: number = 0;
        for (let i: number = 0; i < count; i++) {
            if (offset + 4 > data.length) {
                strings.push(undefined);
                continue;
            }
            const length: number = data.readUInt32BE(offset);
            strings.push(data.subarray(offset + 4, offset + 4 + length).toString());
            offset += 4 + length;
        }
        return strings;
    }

    /**
     * Writes data into a file at an offset, growing it where the data reaches past its end.
     * @param path - The file.
     * @param offset - Where the data goes.
     * @param data - The data.
     */
    protected writeAt(path: string, offset: number, data: Buffer): void {
        const file: Buffer = this.files.get(path) ?? Buffer.alloc(0);
        const grown: Buffer = file.length >= offset + data.length
            ? file
            : Buffer.concat([file, Buffer.alloc(offset + data.length - file.length)]);
        data.copy(grown, offset);
        this.files.set(path, grown);
        this.modifiedAt.set(path, this.resolveNow());
    }

    private resolveHostKeyFingerprint(): string {
        const parsed: ParsedKey | Error = utils.parseKey(this.hostKey.public);
        if (parsed instanceof Error) {
            throw parsed;
        }
        // what OpenSSH prints: the sha256 of the key as it is sent, in base64 without its padding
        return `SHA256:${createHash('sha256').update(parsed.getPublicSSH())
            .digest('base64')
            .replace(/=+$/, '')}`;
    }
}