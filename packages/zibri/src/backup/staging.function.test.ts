import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupDigest, followFile, stage } from './staging.function.ts';
import { testFileFolder } from '../__testing__/constants.ts';
import { FsPath, FsUtilities } from '../utilities/fs.utilities.ts';

const stagingFolder: FsPath = FsUtilities.getPath(testFileFolder, 'staging-function');

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

describe('stage / followFile', () => {
    let p: FsPath;

    beforeEach(async () => {
        await FsUtilities.mkdir(stagingFolder);
        p = FsUtilities.getPath(stagingFolder, 'archive');
        await FsUtilities.createFile(p, '');
    });

    afterEach(async () => {
        await FsUtilities.rm(stagingFolder);
    });

    it('writes what it was given and says what went past', async () => {
        const content: string = 'the whole archive';

        const digest: BackupDigest = await stage(Readable.from([content]), p);

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
        const written: Promise<BackupDigest> = stage(slowly(chunks, 5), p);

        // started while the write is still going, which is the whole point: a reader that waited for
        // the file to be finished would make storing and sending happen one after the other
        const read: Buffer[] = [];
        for await (const chunk of followFile(p, written)) {
            read.push(chunk);
        }
        await written;

        expect(Buffer.concat(read).toString()).toBe(chunks.join(''));
    });

    it('gives every reader the whole of it, however many are following', async () => {
        const chunks: string[] = Array.from({ length: 20 }, (_, i) => `line ${i}\n`);
        const written: Promise<BackupDigest> = stage(slowly(chunks, 5), p);

        /**
         * Drains one follower.
         * @returns Everything it saw.
         */
        async function readAll(): Promise<string> {
            const seen: Buffer[] = [];
            for await (const chunk of followFile(p, written)) {
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
        const written: Promise<BackupDigest> = stage(Readable.from([bytes]), p);

        const read: Buffer[] = [];
        for await (const chunk of followFile(p, written)) {
            read.push(chunk);
        }

        expect(Buffer.concat(read).equals(bytes)).toBe(true);
    });

    it('hands a reader a character whose bytes it reads in two passes', async () => {
        // the two halves of "ü" landing further apart than a reader polls, so it reads them as two
        // ranges. Decoded as text per range, each half is a character nobody wrote
        const umlaut: Buffer = Buffer.from('ü');
        const written: Promise<BackupDigest> = stage(slowly([umlaut.subarray(0, 1), umlaut.subarray(1)], 150), p);

        const read: Buffer[] = [];
        for await (const chunk of followFile(p, written)) {
            read.push(chunk);
        }
        await written;

        expect(read.length).toBeGreaterThan(1);
        expect(Buffer.concat(read).toString()).toBe('ü');
    });

    it('reads a file that was already finished before anyone followed it', async () => {
        const written: Promise<BackupDigest> = stage(Readable.from(['already done']), p);
        await written;

        const read: Buffer[] = [];
        for await (const chunk of followFile(p, written)) {
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
        const written: Promise<BackupDigest> = stage(failing, p);

        // a reader waits for more whenever it has caught up, so a source that fails without saying so
        // is a transport waiting for an end that is never coming - a backup that hangs instead of one
        // that fails
        await expect((async () => {
            for await (const chunk of followFile(p, written)) {
                expect(chunk).toBeInstanceOf(Buffer);
            }
        })()).rejects.toThrow('the dump died');

        await expect(written).rejects.toThrow('the dump died');
    });
});