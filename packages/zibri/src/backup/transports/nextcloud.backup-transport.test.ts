import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { InProcessWebDavServer, InProcessWebDavShare } from '../../__testing__/web-dav/in-process-web-dav-server.model';
import { WebDavTestServerUtilities } from '../../__testing__/web-dav/web-dav-test-server.utilities';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { GlobalRegistry } from '../../global/global-registry';
import { LoggerInterface } from '../../logging/logger.interface';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { NextcloudBackupReaders } from './nextcloud/nextcloud-backup-readers.model';
import { NextcloudBackupTransport } from './nextcloud.backup-transport';

// what the Nextcloud transport sends beside what every WebDAV transport does, against a server in this process that
// answers as Nextcloud does: the shares of the folder, and the trash bin. What Nextcloud itself does is held by
// nextcloud.backup-transport.nextcloud.test.ts

const USER: string = 'backup';

const server: InProcessWebDavServer = new InProcessWebDavServer(USER, 'Backup-app-password');

/**
 * A transport of a folder of its own below the files of the user.
 * @param folder - The folder.
 * @param sharedWith - Who the folder is shared with.
 * @returns The transport.
 */
function createTransport(folder: string, sharedWith: NextcloudBackupReaders): NextcloudBackupTransport {
    return new NextcloudBackupTransport('nextcloud-backup-transport', {
        connection: { ...server.connection, url: `${server.connection.url}files/${USER}/` },
        folder,
        network: undefined,
        sharedWith
    });
}

/**
 * Runs work on a session of a transport, closed once the work is done.
 * @param transport - The transport.
 * @param work - The work.
 * @returns What it returned.
 */
async function withSession<T>(transport: NextcloudBackupTransport, work: (session: BackupTransportSessionInterface) => Promise<T>): Promise<T> {
    const session: BackupTransportSessionInterface = await transport.openSession();
    try {
        return await work(session);
    }
    finally {
        await session.close();
    }
}

/**
 * The shares of a folder of the user, as the server keeps them.
 * @param folder - The folder, below the files of the user.
 * @returns The shares.
 */
function findShares(folder: string): InProcessWebDavShare[] {
    return [...server.shares.values()].filter(share => share.path === `/${folder}`);
}

/**
 * A share of a folder of the user, as somebody created it in Nextcloud.
 * @param folder - The folder, below the files of the user.
 * @param share - Who it is for, and what it permits.
 * @returns The id of the share.
 */
function addShare(folder: string, share: Pick<InProcessWebDavShare, 'shareType' | 'shareWith' | 'permissions'>): string {
    return server.addShare({ ...share, path: `/${folder}`, url: undefined, password: undefined, expiresOn: undefined });
}

beforeAll(async () => {
    // the errors of the http client carry translated messages, which an application not created refuses to build
    GlobalRegistry.markAppAsCreated();
    WebDavTestServerUtilities.initContainer();
    await server.start();
    server.createFolder(`files/${USER}`);
});

afterAll(async () => {
    await server.stop();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describeBackupTransport('NextcloudBackupTransport', () => createTransport('cases', { users: [], groups: [] }));

describe('NextcloudBackupTransport, sharing its folder', () => {
    it('creates the folder and shares it with the readers to read, before the first put', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;

        await withSession(createTransport(folder, { users: ['grace'], groups: ['admin'] }), async session => {
            await session.put('record', Readable.from([Buffer.from('{}')]));
        });

        expect(findShares(folder).map(share => [share.shareType, share.shareWith, share.permissions])
            .sort()).toEqual([[0, 'grace', 1], [1, 'admin', 1]]);
    });

    it('shares the folder once, whatever the sessions writing into it', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: ['grace'], groups: [] });

        await Promise.all(['first', 'second', 'third'].map(async key => await withSession(transport, async session => {
            await session.put(key, Readable.from([Buffer.from(key)]));
        })));

        expect(findShares(folder).map(share => share.shareWith)).toEqual(['grace']);
    });

    it('makes a share that allows writing read-only again, and logs it as an error', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        server.createFolder(`files/${USER}/${folder}`);
        const shareId: string = addShare(folder, { shareType: 1, shareWith: 'admin', permissions: 31 });
        const error: jest.SpiedFunction<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

        await withSession(createTransport(folder, { users: [], groups: ['admin'] }), async session => {
            await session.put('record', Readable.from([Buffer.from('{}')]));
        });

        expect(server.shares.get(shareId)?.permissions).toBe(1);
        expect(findShares(folder)).toHaveLength(1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(`The share ${shareId} is read-only again.`) }));
    });

    it('deletes a share by link and one by email, and logs each as an error', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        server.createFolder(`files/${USER}/${folder}`);
        const link: string = addShare(folder, { shareType: 3, shareWith: undefined, permissions: 1 });
        const email: string = addShare(folder, { shareType: 4, shareWith: undefined, permissions: 1 });
        const error: jest.SpiedFunction<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

        await withSession(createTransport(folder, { users: [], groups: [] }), async session => {
            await session.put('record', Readable.from([Buffer.from('{}')]));
        });

        expect(findShares(folder)).toEqual([]);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(`was shared by a link. The share ${link} is deleted.`) }));
        expect(error).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining(`was shared beyond the users and groups of the Nextcloud. The share ${email} is deleted.`)
        }));
    });

    it('leaves a share to read with a user its options do not name, and warns about it', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        server.createFolder(`files/${USER}/${folder}`);
        const shareId: string = addShare(folder, { shareType: 0, shareWith: 'charles', permissions: 1 });
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');

        await withSession(createTransport(folder, { users: [], groups: [] }), async session => {
            await session.put('record', Readable.from([Buffer.from('{}')]));
        });

        expect(server.shares.get(shareId)).toMatchObject({ shareWith: 'charles', permissions: 1 });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('is shared with the user "charles", which its options do not name'));
    });

    it('checks the shares before a session writes, and not for a session that only reads', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: ['grace'], groups: [] });
        await withSession(transport, async session => await session.put('record', Readable.from([Buffer.from('{}')])));
        server.deleteShare(findShares(folder)[0]?.id ?? '');

        await withSession(transport, async session => {
            for await (const page of session.findKeys('')) {
                expect(page).toEqual(['record']);
            }
        });

        expect(findShares(folder)).toEqual([]);
    });
});

describe('NextcloudBackupTransport, deleting', () => {
    it('deletes what it deleted from the trash bin as well, the folders it emptied included, and nothing else', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: [], groups: [] });
        await withSession(transport, async session => {
            await session.put('chunks/ab/abcdef', Readable.from([Buffer.from('a chunk')]));
            await session.put('chunks/cd/cdef01', Readable.from([Buffer.from('another chunk')]));
        });
        // what somebody else deleted from the folder, theirs to bring back
        server.trashBin.set('notes.txt.d1764160000', { originalLocation: `${folder}/notes.txt`, kind: 'file', size: 5, deletedAt: 1764160000 });

        await withSession(transport, async session => await session.delete(['chunks/ab/abcdef']));

        expect([...server.trashBin.values()].filter(entry => entry.originalLocation.startsWith(`${folder}/`)).map(entry => entry.originalLocation))
            .toEqual([`${folder}/notes.txt`]);
        expect(server.findFolderPaths(`files/${USER}/${folder}`)).toEqual([`files/${USER}/${folder}/chunks`, `files/${USER}/${folder}/chunks/cd`]);
        expect(server.findFilePaths(`files/${USER}/${folder}`)).toEqual([`files/${USER}/${folder}/chunks/cd/cdef01`]);
    });

    it('deletes the uploads a put left a day ago from the folder and the trash bin, and keeps one still arriving', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: [], groups: [] });
        server.createFolder(`files/${USER}/${folder}/chunks/ab`);
        server.createFolder(`files/${USER}/${folder}/chunks/cd`);
        const leftBehind: string = `${folder}/chunks/ab/.zibri-upload-${UUIDUtilities.generate()}`;
        const arriving: string = `${folder}/chunks/cd/.zibri-upload-${UUIDUtilities.generate()}`;
        server.edit(`files/${USER}/${leftBehind}`, 'part of a chunk', new Date(Date.now() - Ms.DAY - Ms.HOUR));
        server.edit(`files/${USER}/${arriving}`, 'a chunk being moved into place');

        await withSession(transport, async session => await session.deleteAbandonedUploads?.());

        expect(server.findFilePaths(`files/${USER}/${folder}`)).toEqual([`files/${USER}/${arriving}`]);
        expect(server.findFolderPaths(`files/${USER}/${folder}`)).toEqual([`files/${USER}/${folder}/chunks`, `files/${USER}/${folder}/chunks/cd`]);
        expect([...server.trashBin.values()].filter(entry => entry.originalLocation.startsWith(`${folder}/`))).toEqual([]);
    });
});