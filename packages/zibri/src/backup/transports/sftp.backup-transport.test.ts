import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { utils } from 'ssh2';

import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { SftpBackupTransport } from './sftp.backup-transport';
import { InProcessSftpRequest, InProcessSftpServer } from '../../__testing__/backup/in-process-sftp-server.model';
import { Ms } from '../../utilities/ms';

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

    protected override answerRead(request: InProcessSftpRequest, path: string, offset: number, length: number): void {
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
        if (!this.endsAtWrite) {
            super.answerWrite(request, path, offset, data);
            return;
        }
        this.endConnections();
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