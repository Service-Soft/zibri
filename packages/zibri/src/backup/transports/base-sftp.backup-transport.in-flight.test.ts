/* eslint-disable typescript/no-deprecated -- the transports of 3.0, which 3.x keeps until 4.0 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { utils } from 'ssh2';

import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseSftpBackupTransport } from './base-sftp.backup-transport';
import { Format1BackupTransport } from './format-1.backup-transport';
import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model';
import { InProcessSftpRequest, InProcessSftpServer } from '../../__testing__/backup/in-process-sftp-server.model';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';

// a backup of 100 MB took 46 s to store over sftp and 5 s to fetch: ssh2's write stream keeps one
// WRITE in flight, and sends several at once only of what buffered while one was pending, which its
// default buffer holds about one chunk of. Every packet then waited a round trip of its own.
// In process rather than against a container, so that it runs wherever the suites run: a server of
// ssh2's own, answering each WRITE after a delay, as a server across a network does

const MIB: number = 1024 * 1024;

/**
 * How long the server takes to answer a WRITE, standing in for a round trip.
 */
const WRITE_DELAY_MS: number = 2;

/**
 * How many WRITEs being in flight at once counts as the transport not waiting for each one.
 */
const IN_FLIGHT_AT_LEAST: number = 8;

/**
 * How long the server takes to answer a CLOSE, so that a client ending its connection before the answer
 * does so every time.
 */
const CLOSE_DELAY_MS: number = 100;

/**
 * The server, answering each WRITE and CLOSE after a delay, as a server across a network does.
 */
class DelayingSftpServer extends InProcessSftpServer {
    /**
     * The most WRITEs that were waiting for their answer at once.
     */
    maxInFlight: number = 0;

    /**
     * How many CLOSEs the server answered.
     */
    closesAnswered: number = 0;

    private inFlight: number = 0;

    protected override answerWrite(request: InProcessSftpRequest, path: string, offset: number, data: Buffer): void {
        this.writeAt(path, offset, data);
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        setTimeout(() => {
            this.inFlight--;
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
        }, WRITE_DELAY_MS);
    }

    protected override answerClose(request: InProcessSftpRequest): void {
        setTimeout(() => {
            request.sftp.status(request.reqId, utils.sftp.STATUS_CODE.OK);
            this.closesAnswered++;
        }, CLOSE_DELAY_MS);
    }
}

// it announces no posix rename of OpenSSH, so the target, which a put replaces, is removed first
const server: DelayingSftpServer = new DelayingSftpServer();

/**
 * The transport, pointed at the server.
 */
class InProcessSftpBackupTransport extends BaseSftpBackupTransport {
    override readonly name: string = 'in-process-sftp-backup-transport';
    protected override get options(): SftpBackupTransportOptions {
        return server.getOptions('/backups');
    }
}

beforeAll(async () => {
    await server.start();
});

afterAll(async () => {
    await server.stop();
});

describe('BaseSftpBackupTransport, storing', () => {
    it('keeps several writes in flight, and stores every byte where it belongs', async () => {
        const data: Buffer = randomBytes(8 * MIB);
        const backup: BackupEntity = Object.assign(new BackupEntity(), { name: 'in-flight' });
        const resource: BackupResourceEntity = Object.assign(new BackupResourceEntity(), { name: 'Data', size: data.length });
        // in the chunks a staged file is read in
        const chunks: Buffer[] = Array.from({ length: data.length / (64 * 1024) }, (_, i) => data.subarray(i * 64 * 1024, (i + 1) * 64 * 1024));

        await new Format1BackupTransport(new InProcessSftpBackupTransport()).storeData(Readable.from(chunks), backup, resource);

        // under the name format 1 always gave it, with nothing written under another left behind
        expect([...server.files.keys()]).toEqual(['/backups/in-flight/Data']);
        expect(server.files.get('/backups/in-flight/Data')?.equals(data)).toBe(true);
        expect(server.maxInFlight).toBeGreaterThanOrEqual(IN_FLIGHT_AT_LEAST);
    }, 60000);
});

// a file read to its end is closed on the server after its reader has the last of it. Closing the
// session ended the connection before the server answered, and the stream failed with an error nobody
// listened to any more, ending the process: every chunk a restore reads is such a file
describe('BaseSftpBackupTransport, reading', () => {
    it('closes a session only once every file it read is closed on the server', async () => {
        const data: Buffer = randomBytes(256 * 1024);
        server.files.set('/backups/read/Data', data);
        const session: BackupTransportSessionInterface = await new InProcessSftpBackupTransport().openSession();
        const answeredBefore: number = server.closesAnswered;

        const read: Buffer = await buffer(await session.get('read/Data', data.length));
        await session.close();

        expect(read.equals(data)).toBe(true);
        // the file the read opened, answered before the connection ended
        expect(server.closesAnswered - answeredBefore).toBe(1);
    }, 30000);
});