import { utimes } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { afterAll, describe, expect, it, jest } from '@jest/globals';

import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { FsBackupTransport } from './fs.backup-transport';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `fs-backup-transport-${UUIDUtilities.generate()}`);

afterAll(async () => {
    await FsUtilities.rm(folder);
});

describeBackupTransport('FsBackupTransport', () => new FsBackupTransport('fs-backup-transport', folder));

describe('FsBackupTransport on the disk', () => {
    // a crash cannot be had in a test, so what is checked is the order a crash depends on: written to the
    // disk before it takes its name, and the name on the disk before the put returns
    it('puts a blob on the disk before its name, and its name, and each folder made for it, before it returns', async () => {
        const storeFolder: FsPath = FsUtilities.getPath(folder, `durable-${UUIDUtilities.generate()}`);
        await FsUtilities.mkdir(storeFolder);
        const session: BackupTransportSessionInterface = await new FsBackupTransport('fs-backup-transport', storeFolder).openSession();
        const sync: jest.Spied<typeof FsUtilities.sync> = jest.spyOn(FsUtilities, 'sync');
        const rename: jest.Spied<typeof FsUtilities.rename> = jest.spyOn(FsUtilities, 'rename');
        const syncDirectory: jest.Spied<typeof FsUtilities.syncDirectory> = jest.spyOn(FsUtilities, 'syncDirectory');
        try {
            // into two folders new to the store
            await session.put('first/second/blob', Readable.from([Buffer.from('held')]));

            const [[synced] = []] = sync.mock.calls;
            const [[renamed] = []] = rename.mock.calls;
            expect(synced).toBe(renamed);
            expect(synced == undefined ? undefined : FsUtilities.dirName(synced)).toBe(FsUtilities.getPath(storeFolder, '.partial'));
            expect(sync.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0] ?? 0);
            expect(syncDirectory.mock.calls.map(([p]) => FsUtilities.relative(storeFolder, p))).toEqual(['first/second', 'first', '']);
            expect(Math.min(...syncDirectory.mock.invocationCallOrder)).toBeGreaterThan(rename.mock.invocationCallOrder[0] ?? Infinity);
        }
        finally {
            await session.close();
            sync.mockRestore();
            rename.mockRestore();
            syncDirectory.mockRestore();
        }
        expect(await FsUtilities.readFile(FsUtilities.getPath(storeFolder, 'first', 'second', 'blob'))).toBe('held');
    });

    // a process going down in the middle of a put left its file behind, which nothing listed and nothing
    // removed, and which kept the folder of its backup from being removed with the backup
    it('deletes what puts left in the staging folder a day ago at its first put, neither what one still writes nor when only reading, and lists none of it', async () => {
        const storeFolder: FsPath = FsUtilities.getPath(folder, `staging-${UUIDUtilities.generate()}`);
        const leftBehind: FsPath = FsUtilities.getPath(storeFolder, '.partial', 'left-behind');
        const beingWritten: FsPath = FsUtilities.getPath(storeFolder, '.partial', 'being-written');
        await FsUtilities.createFile(leftBehind, 'part of a blob');
        await FsUtilities.createFile(beingWritten, 'part of a blob');
        const twoDaysAgo: Date = new Date(Date.now() - (2 * Ms.DAY));
        await utimes(leftBehind, twoDaysAgo, twoDaysAgo);
        const session: BackupTransportSessionInterface = await new FsBackupTransport('fs-backup-transport', storeFolder).openSession();
        const keys: string[] = [];
        const names: string[] = [];
        try {
            await expect(session.get('backup/blob', 1024)).rejects.toThrow();
            expect(await FsUtilities.exists(leftBehind)).toBe(true);

            await session.put('backup/blob', Readable.from([Buffer.from('whole')]));
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

        expect(await FsUtilities.exists(leftBehind)).toBe(false);
        expect(await FsUtilities.exists(beingWritten)).toBe(true);
        expect(keys).toEqual(['backup/blob']);
        expect(names).toEqual(['backup']);
    });
});

// a prefix naming part of a folder's name, such as `cases-<uuid>` or `.zibri-repository/chunks`, read every folder of
// the store, and whether a backup's folder held anything was answered after a thousand keys of it
describe('FsBackupTransport, listing', () => {
    it('reads only the folders that can hold a key starting with the prefix', async () => {
        const storeFolder: FsPath = FsUtilities.getPath(folder, `listed-${UUIDUtilities.generate()}`);
        for (const key of ['wanted/a', 'wanted-too/b', 'other/deep/c', 'repository/chunks/ab/d', 'repository/backups/e']) {
            await FsUtilities.createFile(FsUtilities.getPath(storeFolder, ...key.split('/')), key);
        }
        const session: BackupTransportSessionInterface = await new FsBackupTransport('fs-backup-transport', storeFolder).openSession();
        const readdir: jest.Spied<typeof FsUtilities.readdir> = jest.spyOn(FsUtilities, 'readdir');
        const findRead: () => string[] = () => readdir.mock.calls.map(([p]) => FsUtilities.relative(storeFolder, p)).sort();
        try {
            const wanted: string[] = [];
            for await (const page of session.findKeys('wanted')) {
                wanted.push(...page);
            }
            expect(wanted.sort()).toEqual(['wanted-too/b', 'wanted/a']);
            expect(findRead()).toEqual(['', 'wanted', 'wanted-too']);
            readdir.mockClear();

            const chunks: string[] = [];
            for await (const page of session.findKeys('repository/chunks')) {
                chunks.push(...page);
            }
            expect(chunks).toEqual(['repository/chunks/ab/d']);
            expect(findRead()).toEqual(['repository', 'repository/chunks', 'repository/chunks/ab']);
        }
        finally {
            await session.close();
            readdir.mockRestore();
        }
    });

    // what tells a backup's folder holding anything from one left empty, which needs one key and no more
    it('hands over the keys of a folder before it reads the next', async () => {
        const storeFolder: FsPath = FsUtilities.getPath(folder, `paged-${UUIDUtilities.generate()}`);
        for (let i: number = 0; i < 20; i++) {
            await FsUtilities.createFile(FsUtilities.getPath(storeFolder, `folder-${i}`, 'key'), 'key');
        }
        const session: BackupTransportSessionInterface = await new FsBackupTransport('fs-backup-transport', storeFolder).openSession();
        const readdir: jest.Spied<typeof FsUtilities.readdir> = jest.spyOn(FsUtilities, 'readdir');
        let first: string[] = [];
        let read: number = 0;
        try {
            for await (const page of session.findKeys('')) {
                first = page;
                break;
            }
            read = readdir.mock.calls.length;
        }
        finally {
            await session.close();
            readdir.mockRestore();
        }

        expect(first).toHaveLength(1);
        // the top, and the folder of the key
        expect(read).toBe(2);
    });
});