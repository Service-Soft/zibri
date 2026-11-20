import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Client, ClientSFTPCallback, Connection, SFTPWrapper, utils } from 'ssh2';

import { InProcessSftpLogin, InProcessSftpRequest, InProcessSftpServer } from '../../__testing__/backup/in-process-sftp-server.model';
import { Ms } from '../../utilities/ms';
import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { SftpBackupTransport } from './sftp.backup-transport';

// against a server in the test's own process, which a case has answer as a server the transport does not
// control can: wrongly, refusing, or not at all. What a real server accepts is checked against one in a
// container in base-sftp.backup-transport.test.ts

const MIB: number = 1024 * 1024;

/**
 * How long a case may take, the connection to the server included.
 */
const CASE_TIMEOUT_IN_MS: number = 30_000;

/**
 * How much a file the server lies about the size of is answered with, before it ends after all.
 */
const LIED_ABOUT_SIZE: number = 4 * MIB;

/**
 * The server, answering as each case has it.
 */
class MisbehavingSftpServer extends InProcessSftpServer {
    /**
     * The files whose STAT says they hold one byte, and whose READs are answered with far more.
     */
    readonly liedAbout: Set<string> = new Set();

    /**
     * Whether the server refuses to rename, OpenSSH's posix rename included, as a server does a target it
     * may not replace. It still removes files.
     */
    refusesRenames: boolean = false;

    /**
     * Whether the server ends the connection at the first WRITE, rather than answering it.
     */
    endsAtWrite: boolean = false;

    /**
     * The paths whose STAT the server refuses, as it does a file in a folder the user may not enter.
     */
    readonly unreachable: Set<string> = new Set();

    /**
     * The files whose OPEN the server refuses, as it does a file the user may find and not read.
     */
    readonly unreadable: Set<string> = new Set();

    /**
     * The requests the server leaves unanswered, while the connection stays up: `REMOVE`, `WRITE` or `READ`.
     */
    readonly unanswered: Set<'REMOVE' | 'WRITE' | 'READ'> = new Set();

    /**
     * How long after the one before the server answers each WRITE, as a slow server does, which still answers.
     */
    writeDelayMs: number = 0;

    /**
     * Whether the server logs a client in and opens no SFTP session for it, as a server without the subsystem does.
     */
    opensNoSftp: boolean = false;

    /**
     * Whether the server ends the connection of a client logging in, as one refusing the address it comes from does.
     */
    endsAtLogin: boolean = false;

    /**
     * The directories a client opened to read, by their path.
     */
    readonly openedDirectories: Set<string> = new Set();

    private writesAnswered: Promise<void> = Promise.resolve();

    /**
     * Stores a file on the server directly, with the directories leading to it.
     * @param path - The path of the file.
     */
    storeFile(path: string): void {
        for (let directory: string = posix.dirname(path); directory !== '/'; directory = posix.dirname(directory)) {
            this.directories.add(directory);
        }
        this.files.set(path, Buffer.from(path));
    }

    protected override answerOpenDirectory(request: InProcessSftpRequest, path: string): void {
        this.openedDirectories.add(path);
        super.answerOpenDirectory(request, path);
    }

    protected override answerSftpRequest(acceptSftp: () => SFTPWrapper, connection: Connection): void {
        if (!this.opensNoSftp) {
            super.answerSftpRequest(acceptSftp, connection);
        }
    }

    protected override answerLogin(login: InProcessSftpLogin): void {
        if (this.endsAtLogin) {
            login.connection.end();
            return;
        }
        super.answerLogin(login);
    }

    protected override answerStat(request: InProcessSftpRequest, path: string): void {
        if (this.unreachable.has(path)) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
            return;
        }
        if (!this.liedAbout.has(path)) {
            super.answerStat(request, path);
            return;
        }
        request.sftp.attrs(request.reqId, { mode: 0o100644, uid: 0, gid: 0, size: 1, atime: 0, mtime: 0 });
    }

    protected override answerOpen(request: InProcessSftpRequest, path: string, flags: number): void {
        if (this.unreadable.has(path)) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
            return;
        }
        super.answerOpen(request, path, flags);
    }

    protected override answerRemove(request: InProcessSftpRequest, path: string): void {
        if (!this.unanswered.has('REMOVE')) {
            super.answerRemove(request, path);
        }
    }

    protected override answerRead(request: InProcessSftpRequest, path: string, offset: number, length: number): void {
        if (this.unanswered.has('READ')) {
            return;
        }
        if (!this.liedAbout.has(path)) {
            super.answerRead(request, path, offset, length);
            return;
        }
        if (offset >= LIED_ABOUT_SIZE) {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.EOF);
            return;
        }
        request.sftp.data(request.reqId, Buffer.alloc(Math.min(length, LIED_ABOUT_SIZE - offset), 'x'));
    }

    protected override answerWrite(request: InProcessSftpRequest, path: string, offset: number, data: Buffer): void {
        if (this.unanswered.has('WRITE')) {
            return;
        }
        if (this.endsAtWrite) {
            this.endConnections();
            return;
        }
        if (this.writeDelayMs === 0) {
            super.answerWrite(request, path, offset, data);
            return;
        }
        // one after another, so that the last of many sent at once waits for all of them
        this.writesAnswered = this.writesAnswered
            // eslint-disable-next-line promise/prefer-await-to-then
            .then(async () => await wait(this.writeDelayMs))
            // eslint-disable-next-line promise/prefer-await-to-then
            .then(() => super.answerWrite(request, path, offset, data));
    }

    protected override answerRename(request: InProcessSftpRequest, from: string, to: string): void {
        if (!this.refusesRenames) {
            super.answerRename(request, from, to);
            return;
        }
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
    }

    protected override answerExtended(request: InProcessSftpRequest, name: string, data: Buffer): void {
        if (!this.refusesRenames) {
            super.answerExtended(request, name, data);
            return;
        }
        request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
    }
}

// announcing OpenSSH's posix rename, as OpenSSH does
const server: MisbehavingSftpServer = new MisbehavingSftpServer({ 'posix-rename@openssh.com': '1' });

/**
 * Opens a session of the transport kept on the server.
 * @returns The session.
 */
async function openSession(): Promise<BackupTransportSessionInterface> {
    return await new SftpBackupTransport('in-process-sftp-backup-transport', server.getOptions('/blobs')).openSession();
}

beforeAll(async () => {
    await server.start();
});

afterAll(async () => {
    await server.stop();
});

beforeEach(() => {
    server.liedAbout.clear();
    server.unreachable.clear();
    server.unreadable.clear();
    server.refusesRenames = false;
    server.endsAtWrite = false;
    server.unanswered.clear();
    server.writeDelayMs = 0;
    server.opensNoSftp = false;
    server.endsAtLogin = false;
    server.openedDirectories.clear();
});

describe('SftpBackupTransport, a server it does not control', () => {
    it('refuses a file that holds more than it may as it arrives, whatever the server said its size is', async () => {
        server.liedAbout.add('/blobs/lied-about/data');
        const session: BackupTransportSessionInterface = await openSession();
        try {
            await expect(session.get('lied-about/data', 1024).then(async data => await buffer(data))).rejects.toThrow('larger than the 1024 bytes');
        }
        finally {
            await session.close();
        }
    }, CASE_TIMEOUT_IN_MS);

    it('leaves what a key held when the server refuses to replace it', async () => {
        const session: BackupTransportSessionInterface = await openSession();
        try {
            await session.put('kept/data', Readable.from([Buffer.from('as it was')]));
            server.refusesRenames = true;

            await expect(session.put('kept/data', Readable.from([Buffer.from('the replacement')]))).rejects.toThrow();
        }
        finally {
            await session.close();
        }

        expect(server.files.get('/blobs/kept/data')?.toString()).toBe('as it was');
        // nor what the refused put wrote
        expect([...server.files.keys()].filter(path => path.startsWith('/blobs/kept/') || path.startsWith('/blobs/.partial/'))).toEqual(['/blobs/kept/data']);
    }, CASE_TIMEOUT_IN_MS);

    // what the sync skips with a warning, where any other error fails it
    it('refuses a key it may not reach, or may find and not read, as access denied', async () => {
        server.files.set('/blobs/denied/unreachable', Buffer.from('x'));
        server.files.set('/blobs/denied/unreadable', Buffer.from('x'));
        server.unreachable.add('/blobs/denied/unreachable');
        server.unreadable.add('/blobs/denied/unreadable');
        const session: BackupTransportSessionInterface = await openSession();
        try {
            await expect(session.get('denied/unreachable', 1024)).rejects.toBeInstanceOf(BackupKeyAccessDeniedError);
            await expect(session.get('denied/unreadable', 1024).then(async data => await buffer(data))).rejects.toBeInstanceOf(BackupKeyAccessDeniedError);
        }
        finally {
            await session.close();
        }
    }, CASE_TIMEOUT_IN_MS);
});

// a connection ending in the middle of a put left its file behind, which nothing listed and nothing removed,
// and which kept the folder of its backup from being removed with the backup
describe('SftpBackupTransport, the staging folder', () => {
    it('deletes what puts left in it a day ago at its first put, neither what one still writes nor when only reading, and lists none of it', async () => {
        const nowInSeconds: number = Math.floor(Date.now() / Ms.SECOND);
        server.directories.add('/staged');
        server.directories.add('/staged/.partial');
        server.files.set('/staged/.partial/left-behind', Buffer.from('part of a blob'));
        server.modifiedAt.set('/staged/.partial/left-behind', nowInSeconds - (2 * Ms.DAY / Ms.SECOND));
        server.files.set('/staged/.partial/being-written', Buffer.from('part of a blob'));
        server.modifiedAt.set('/staged/.partial/being-written', nowInSeconds);
        const session: BackupTransportSessionInterface = await new SftpBackupTransport('in-process-sftp-backup-transport', server.getOptions('/staged')).openSession();
        const keys: string[] = [];
        const names: string[] = [];
        try {
            await expect(session.get('backup/data', 1024)).rejects.toThrow();
            expect(server.files.has('/staged/.partial/left-behind')).toBe(true);

            await session.put('backup/data', Readable.from([Buffer.from('whole')]));
            for await (const page of session.findKeys('')) {
                keys.push(...page);
            }
            for await (const page of session.findNames('')) {
                names.push(...page);
            }
        }
        finally {
            await session.close();
        }

        expect([...server.files.keys()].filter(path => path.startsWith('/staged/')).sort()).toEqual(['/staged/.partial/being-written', '/staged/backup/data']);
        expect(keys).toEqual(['backup/data']);
        expect(names).toEqual(['backup']);
    }, CASE_TIMEOUT_IN_MS);
});

// each folder read is a round trip of its own: a prefix naming part of a folder's name, such as `cases-<uuid>` or
// `.zibri-repository/chunks`, read every folder of the store, and whether a backup's folder held anything was
// answered after a thousand keys of it. On a store of many backups across a network that took minutes
describe('SftpBackupTransport, listing', () => {
    /**
     * Every key a listing finds.
     * @param session - The session.
     * @param prefix - The prefix.
     * @returns The keys, sorted.
     */
    async function findAllKeys(session: BackupTransportSessionInterface, prefix: string): Promise<string[]> {
        const keys: string[] = [];
        for await (const page of session.findKeys(prefix)) {
            keys.push(...page);
        }
        return keys.sort();
    }

    it('reads only the folders that can hold a key starting with the prefix', async () => {
        for (const path of ['wanted/a', 'wanted-too/b', 'other/deep/c', 'repository/chunks/ab/d', 'repository/backups/e']) {
            server.storeFile(`/listed/${path}`);
        }
        const session: BackupTransportSessionInterface = await new SftpBackupTransport('in-process-sftp-backup-transport', server.getOptions('/listed')).openSession();
        try {
            expect(await findAllKeys(session, 'wanted')).toEqual(['wanted-too/b', 'wanted/a']);
            expect([...server.openedDirectories].sort()).toEqual(['/listed', '/listed/wanted', '/listed/wanted-too']);
            server.openedDirectories.clear();

            expect(await findAllKeys(session, 'repository/chunks')).toEqual(['repository/chunks/ab/d']);
            expect([...server.openedDirectories].sort()).toEqual(['/listed/repository', '/listed/repository/chunks', '/listed/repository/chunks/ab']);
        }
        finally {
            await session.close();
        }
    }, CASE_TIMEOUT_IN_MS);

    // what tells a backup's folder holding anything from one left empty, which needs one key and no more
    it('hands over the keys of a folder before it reads the next', async () => {
        for (let i: number = 0; i < 20; i++) {
            server.storeFile(`/paged/folder-${i}/key`);
        }
        const session: BackupTransportSessionInterface = await new SftpBackupTransport('in-process-sftp-backup-transport', server.getOptions('/paged')).openSession();
        let first: string[] = [];
        try {
            for await (const page of session.findKeys('')) {
                first = page;
                break;
            }
        }
        finally {
            await session.close();
        }

        expect(first).toHaveLength(1);
        // the top, and the folder of the key
        expect(server.openedDirectories.size).toBe(2);
    }, CASE_TIMEOUT_IN_MS);
});

describe('SftpBackupTransport, a connection that ends', () => {
    it('fails a put whose connection ends while it writes', async () => {
        server.endsAtWrite = true;
        const session: BackupTransportSessionInterface = await openSession();
        try {
            const chunks: Buffer[] = Array.from({ length: 16 }, () => randomBytes(64 * 1024));
            await expect(session.put('lost/data', Readable.from(chunks))).rejects.toThrow();
        }
        finally {
            await session.close();
        }
    }, CASE_TIMEOUT_IN_MS);

    // a server that keeps the connection up and never answers left a backup waiting forever: the keepalive only
    // ends a connection that is gone
    describe('to a server that stops answering', () => {
        const REQUEST_TIMEOUT_IN_MS: number = 300;

        /**
         * Opens a session that waits for an answer of the server for as long as the cases here have it.
         * @returns The session.
         */
        async function openWaitingSession(): Promise<BackupTransportSessionInterface> {
            return await new SftpBackupTransport(
                'in-process-sftp-backup-transport',
                { ...server.getOptions('/blobs'), requestTimeoutInMs: REQUEST_TIMEOUT_IN_MS }
            ).openSession();
        }

        it('fails a request the server does not answer, naming it, and every request after', async () => {
            server.unanswered.add('REMOVE');
            const session: BackupTransportSessionInterface = await openWaitingSession();

            await expect(session.delete(['silent/data'])).rejects.toThrow(`within ${REQUEST_TIMEOUT_IN_MS} ms: REMOVE of "/blobs/silent/data"`);
            await expect(session.get('silent/data', 1024)).rejects.toThrow(`within ${REQUEST_TIMEOUT_IN_MS} ms`);
            await expect(session.close()).resolves.toBeUndefined();
        }, CASE_TIMEOUT_IN_MS);

        it('fails a put whose writes the server stops answering', async () => {
            server.unanswered.add('WRITE');
            const session: BackupTransportSessionInterface = await openWaitingSession();
            try {
                await expect(session.put('silent/data', Readable.from([randomBytes(64 * 1024)]))).rejects.toThrow(/: WRITE of "\/blobs\/\.partial\//);
            }
            finally {
                await session.close();
            }
        }, CASE_TIMEOUT_IN_MS);

        it('fails a file being read whose reads the server stops answering', async () => {
            server.files.set('/blobs/silent/data', randomBytes(1024));
            server.unanswered.add('READ');
            const session: BackupTransportSessionInterface = await openWaitingSession();
            try {
                await expect(session.get('silent/data', 1024).then(async data => await buffer(data))).rejects.toThrow(': READ of "/blobs/silent/data"');
            }
            finally {
                await session.close();
            }
        }, CASE_TIMEOUT_IN_MS);

        it('fails opening a session on a server that logs in and opens no SFTP session', async () => {
            server.opensNoSftp = true;
            const transport: SftpBackupTransport = new SftpBackupTransport(
                'in-process-sftp-backup-transport',
                { ...server.getOptions('/blobs'), connectTimeoutInMs: REQUEST_TIMEOUT_IN_MS }
            );

            await expect(transport.openSession()).rejects
                .toThrow(`did not open the SFTP subsystem for the transport "in-process-sftp-backup-transport" within ${REQUEST_TIMEOUT_IN_MS} ms`);
        }, CASE_TIMEOUT_IN_MS);

        // ssh2 stops its ready timeout once the connection closes, and reports no error for a server ending it as the
        // application: the session waited forever, and so did every one after it on a server refusing them all
        it('fails opening a session on a server that ends the connection while the client logs in', async () => {
            server.endsAtLogin = true;
            const transport: SftpBackupTransport = new SftpBackupTransport(
                'in-process-sftp-backup-transport',
                { ...server.getOptions('/blobs'), connectTimeoutInMs: Ms.MINUTE }
            );

            await expect(transport.openSession()).rejects
                .toThrow('The server "127.0.0.1" closed the connection of the transport "in-process-sftp-backup-transport" before the login completed.');
        }, CASE_TIMEOUT_IN_MS);

        // ssh2 never asking the server to close a handle, as a stream that never closes would not: the one way to
        // wait for the server with no request out, which no server can bring about
        it('fails what waits for the server while ssh2 asks it nothing, naming it', async () => {
            const openSftp: Client['sftp'] = Client.prototype.sftp;
            jest.spyOn(Client.prototype, 'sftp').mockImplementation(function openWithoutClosing(this: Client, opened: ClientSFTPCallback): Client {
                return openSftp.call(this, (failure, sftp) => {
                    sftp.close = () => undefined;
                    opened(failure, sftp);
                });
            });
            const session: BackupTransportSessionInterface = await openWaitingSession();
            jest.restoreAllMocks();
            const names: string[] = [];
            try {
                await expect((async () => {
                    for await (const page of session.findNames('')) {
                        names.push(...page);
                    }
                })()).rejects.toThrow(`within ${REQUEST_TIMEOUT_IN_MS} ms: READDIR of "/blobs"`);
            }
            finally {
                await session.close();
            }

            // the listing failed rather than handing over what it had
            expect(names).toEqual([]);
        }, CASE_TIMEOUT_IN_MS);

        it('takes as long as a transfer needs while the server answers, and while what reads it waits', async () => {
            // its writes are answered one after another, the last of those sent at once only after all of them
            server.writeDelayMs = REQUEST_TIMEOUT_IN_MS / 10;
            const data: Buffer = randomBytes(MIB);
            const session: BackupTransportSessionInterface = await openWaitingSession();
            const chunks: Buffer[] = [];
            try {
                // a dump that is slow to hand over its data, which nothing waits for the server meanwhile
                await session.put('slow/dumped', Readable.from((async function* slowDump(): AsyncGenerator<Buffer> {
                    yield Buffer.from('the start');
                    await wait(3 * REQUEST_TIMEOUT_IN_MS);
                    yield Buffer.from(' and the rest');
                })()));
                await session.put('slow/data', Readable.from([data]));
                for await (const chunk of await session.get('slow/data', MIB)) {
                    if (!Buffer.isBuffer(chunk)) {
                        throw new TypeError('A chunk of the file was no buffer.');
                    }
                    chunks.push(chunk);
                    // a restore that is slow to take what it reads
                    if (chunks.length === 1) {
                        await wait(3 * REQUEST_TIMEOUT_IN_MS);
                    }
                }
            }
            finally {
                await session.close();
            }

            expect(Buffer.concat(chunks).equals(data)).toBe(true);
        }, CASE_TIMEOUT_IN_MS);
    });

    it('fails a file being read and every request after, and closes, once its connection ended', async () => {
        server.files.set('/blobs/open/data', randomBytes(LIED_ABOUT_SIZE));
        const session: BackupTransportSessionInterface = await openSession();
        const data: Readable = await session.get('open/data', LIED_ABOUT_SIZE);
        server.endConnections();

        await expect(buffer(data)).rejects.toThrow();
        await expect(session.get('open/data', LIED_ABOUT_SIZE)).rejects.toThrow();
        await expect(session.close()).resolves.toBeUndefined();
    }, CASE_TIMEOUT_IN_MS);
});