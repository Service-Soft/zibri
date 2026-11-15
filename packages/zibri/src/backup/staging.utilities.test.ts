import { createHash } from 'node:crypto';
import { FileHandle, open, truncate } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { BackupDigest } from './backup-digest.model';
import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { StagedFile } from './staged-file.model';
import { StagingUtilities } from './staging.utilities';
import { testFileFolder } from '../__testing__/constants';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

const stagingFolder: FsPath = FsUtilities.getPath(testFileFolder, 'staging-utilities');

/**
 * A stream that produces its chunks slowly enough for a reader to catch up with it.
 * @param chunks - What it yields, in order.
 * @param delayInMs - How long to wait between them.
 * @returns The stream.
 */
function slowly(chunks: (string | Buffer)[], delayInMs: number): Readable {
    return Readable.from((async function* produce(): AsyncGenerator<string | Buffer> {
        for (const chunk of chunks) {
            await sleep(delayInMs);
            yield chunk;
        }
    })());
}

describe('StagingUtilities - stage / followFile', () => {
    let p: FsPath;
    let staged: StagedFile;

    beforeEach(async () => {
        await FsUtilities.mkdir(stagingFolder);
        p = FsUtilities.getPath(stagingFolder, 'archive');
        staged = { path: p, compression: 'none', encryption: undefined };
        await FsUtilities.createFile(p, '');
    });

    afterEach(async () => {
        await FsUtilities.rm(stagingFolder);
    });

    it('writes what it was given and says what went past', async () => {
        const content: string = 'the whole archive';

        const digest: BackupDigest = await StagingUtilities.stage(Readable.from([content]), staged);

        expect(await FsUtilities.readFile(p)).toBe(content);
        expect(digest.size).toBe(Buffer.byteLength(content));
        expect(digest.checksum).toBe(
            createHash('sha256')
                .update(content)
                .digest('hex')
        );
    });

    it('hands a reader everything the writer wrote, in order', async () => {
        const chunks: string[] = Array.from({ length: 20 }, (_, i) => `line ${i}\n`);
        const written: Promise<BackupDigest> = StagingUtilities.stage(slowly(chunks, 5), staged);

        // started while the write is still going, which is the whole point: a reader that waited for
        // the file to be finished would make storing and sending happen one after the other
        const read: Buffer[] = [];
        for await (const chunk of StagingUtilities.followFile(p, written)) {
            read.push(chunk);
        }
        await written;

        expect(Buffer.concat(read).toString()).toBe(chunks.join(''));
    });

    it('gives every reader the whole of it, however many are following', async () => {
        const chunks: string[] = Array.from({ length: 20 }, (_, i) => `line ${i}\n`);
        const written: Promise<BackupDigest> = StagingUtilities.stage(slowly(chunks, 5), staged);

        /**
         * Drains one follower.
         * @returns Everything it saw.
         */
        async function readAll(): Promise<string> {
            const seen: Buffer[] = [];
            for await (const chunk of StagingUtilities.followFile(p, written)) {
                seen.push(chunk);
            }
            return Buffer.concat(seen).toString();
        }

        // a stream is consumable once and a file is not, which is what lets each transport have the
        // whole archive without any of them pacing another
        const [first, second]: string[] = await Promise.all([readAll(), readAll()]);
        await written;

        expect(first).toBe(chunks.join(''));
        expect(second).toBe(first);
    });

    it('hands a reader the bytes that were written, when they are not text', async () => {
        // what an encrypted archive is. Read as text, every byte that is not valid utf8 comes back as
        // the three bytes of a replacement character
        const bytes: Buffer = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3]);
        const written: Promise<BackupDigest> = StagingUtilities.stage(Readable.from([bytes]), staged);

        const read: Buffer[] = [];
        for await (const chunk of StagingUtilities.followFile(p, written)) {
            read.push(chunk);
        }

        expect(Buffer.concat(read).equals(bytes)).toBe(true);
    });

    it('hands a reader a character whose bytes it reads in two passes', async () => {
        // the two halves of "ü" landing further apart than a reader polls, so it reads them as two
        // ranges. Decoded as text per range, each half is a character nobody wrote
        const umlaut: Buffer = Buffer.from('ü');
        const written: Promise<BackupDigest> = StagingUtilities.stage(slowly([umlaut.subarray(0, 1), umlaut.subarray(1)], 150), staged);

        const read: Buffer[] = [];
        for await (const chunk of StagingUtilities.followFile(p, written)) {
            read.push(chunk);
        }
        await written;

        expect(read.length).toBeGreaterThan(1);
        expect(Buffer.concat(read).toString()).toBe('ü');
    });

    it('reads a file that was already finished before anyone followed it', async () => {
        const written: Promise<BackupDigest> = StagingUtilities.stage(Readable.from(['already done']), staged);
        await written;

        const read: Buffer[] = [];
        for await (const chunk of StagingUtilities.followFile(p, written)) {
            read.push(chunk);
        }

        // the ending can arrive before the first stat does, and a reader that took that as "nothing
        // is coming" would hand back an empty archive rather than the one that is sitting there
        expect(Buffer.concat(read).toString()).toBe('already done');
    });

    it('stops a reader when the writer fails instead of leaving it waiting', async () => {
        const failing: Readable = Readable.from((async function* produce(): AsyncGenerator<string> {
            yield 'a start';
            await sleep(5);
            throw new Error('the dump died');
        })());
        const written: Promise<BackupDigest> = StagingUtilities.stage(failing, staged);

        // a reader waits for more whenever it has caught up, so a source that fails without saying so
        // is a transport waiting for an end that is never coming - a backup that hangs instead of one
        // that fails
        await expect((async () => {
            for await (const chunk of StagingUtilities.followFile(p, written)) {
                expect(chunk).toBeInstanceOf(Buffer);
            }
        })()).rejects.toThrow('the dump died');

        await expect(written).rejects.toThrow('the dump died');
    });
});

describe('StagingUtilities - stage / read, compressed', () => {
    // what a dump mostly is: text repeating itself, which is what makes the copy on the disk worth compressing
    const data: string = 'INSERT INTO task (title, assignee) VALUES (\'write the docs\', \'ada@example.com\');\n'.repeat(50_000);
    let p: FsPath;
    let compressed: StagedFile;

    beforeEach(async () => {
        await FsUtilities.mkdir(stagingFolder);
        p = FsUtilities.getPath(stagingFolder, 'compressed');
        compressed = { path: p, compression: 'zstd', encryption: undefined };
        await FsUtilities.createFile(p, '');
    });

    afterEach(async () => {
        await FsUtilities.rm(stagingFolder);
    });

    it('stages less than it was given, says what it was given, and reads that back', async () => {
        const digest: BackupDigest = await StagingUtilities.stage(Readable.from([data]), compressed);

        expect((await FsUtilities.stat(p)).size).toBeLessThan(Buffer.byteLength(data) / 10);
        expect(digest).toStrictEqual({
            size: Buffer.byteLength(data),
            checksum: createHash('sha256')
                .update(data)
                .digest('hex')
        });
        expect(await text(StagingUtilities.read(compressed))).toBe(data);
        expect(await StagingUtilities.resolveDigest(compressed)).toStrictEqual(digest);
    });

    it('stages encrypted after it compressed, which only the key it was staged with reads back', async () => {
        const encrypted: StagedFile = { ...compressed, encryption: BackupEncryptionUtilities.generateStagedFileEncryption() };

        const digest: BackupDigest = await StagingUtilities.stage(Readable.from([data]), encrypted);

        expect((await FsUtilities.stat(p)).size).toBeLessThan(Buffer.byteLength(data) / 10);
        await expect(text(StagingUtilities.read(compressed))).rejects.toThrow();
        await expect(text(StagingUtilities.read({ ...encrypted, encryption: BackupEncryptionUtilities.generateStagedFileEncryption() }))).rejects.toThrow();
        expect(await text(StagingUtilities.read(encrypted))).toBe(data);
        expect(await StagingUtilities.resolveDigest(encrypted)).toStrictEqual(digest);
    });

    it('hands a reader following the file everything the writer wrote, once decompressed', async () => {
        const chunks: string[] = Array.from({ length: 20 }, (_, i) => data.slice(i * 1000, (i + 1) * 1000));
        const written: Promise<BackupDigest> = StagingUtilities.stage(slowly(chunks, 5), compressed);

        const read: string = await text(StagingUtilities.decompress(StagingUtilities.followFile(p, written)));
        await written;

        expect(read).toBe(chunks.join(''));
    });

    it('refuses a compressed file that was cut short', async () => {
        await StagingUtilities.stage(Readable.from([data]), compressed);
        // what a host going down before the file reached the disk leaves
        await truncate(p, Math.floor((await FsUtilities.stat(p)).size / 2));

        await expect(StagingUtilities.resolveDigest(compressed)).rejects.toThrow();
    });

    it('refuses a compressed file a byte of which changed on the disk', async () => {
        await StagingUtilities.stage(Readable.from([data]), compressed);
        const file: FileHandle = await open(p, 'r+');
        try {
            const middle: number = Math.floor((await file.stat()).size / 2);
            const byte: Buffer = Buffer.alloc(1);
            await file.read(byte, 0, 1, middle);
            await file.write(Buffer.from([(byte[0] ?? 0) ^ 0xff]), 0, 1, middle);
        }
        finally {
            await file.close();
        }

        await expect(text(StagingUtilities.read(compressed))).rejects.toThrow();
    });
});