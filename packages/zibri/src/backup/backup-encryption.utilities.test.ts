import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { BackupEncryptionUtilities } from './backup-encryption.utilities';

/**
 * How many bytes of data are sealed together, as the utilities seal them.
 */
const CHUNK: number = 64 * 1024;

/**
 * How many bytes a sealed chunk that is not the last one takes.
 */
const SEALED: number = CHUNK + 16;

/**
 * An odd size to feed data in, so that chunk boundaries never line up with what arrives.
 */
const PIECE: number = 7001;

const key: Buffer = BackupEncryptionUtilities.generateKey();

/**
 * Hands out a buffer in pieces, the way a stream does.
 * @param data - The buffer to hand out.
 * @returns A stream of pieces of {@link PIECE} bytes, the last one shorter.
 */
function inPieces(data: Buffer): Readable {
    const pieces: Buffer[] = [];
    for (let offset: number = 0; offset < data.length; offset += PIECE) {
        pieces.push(data.subarray(offset, offset + PIECE));
    }
    return Readable.from(pieces);
}

async function collect(source: AsyncIterable<Buffer>): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const part of source) {
        parts.push(part);
    }
    return Buffer.concat(parts);
}

async function encrypt(data: Buffer): Promise<Buffer> {
    return await collect(BackupEncryptionUtilities.encrypt(inPieces(data), key));
}

async function decrypt(sealed: Buffer, withKey: Buffer = key): Promise<Buffer> {
    return await collect(BackupEncryptionUtilities.decrypt(inPieces(sealed), withKey));
}

describe('BackupEncryptionUtilities', () => {
    it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, (3 * CHUNK) + 5])('round trips %i bytes', async size => {
        const data: Buffer = randomBytes(size);

        const sealed: Buffer = await encrypt(data);

        // one tag per chunk, and always at least the last chunk, however little data there is
        expect(sealed.length).toBe(size + (16 * Math.max(1, Math.ceil(size / CHUNK))));
        expect((await decrypt(sealed)).equals(data)).toBe(true);
    });

    it('refuses a changed byte', async () => {
        const sealed: Buffer = await encrypt(randomBytes(3 * CHUNK));
        sealed.writeUInt8(sealed.readUInt8(SEALED + 10) ^ 1, SEALED + 10);

        await expect(decrypt(sealed)).rejects.toThrow('could not be decrypted at chunk 1');
    });

    it('refuses an archive cut short at a chunk boundary', async () => {
        // every chunk that is left authenticates on its own - what is missing is the one sealed as
        // the last, so the one that now ends the archive is opened as the last and was not sealed so
        const sealed: Buffer = await encrypt(randomBytes((2 * CHUNK) + 5));

        await expect(decrypt(sealed.subarray(0, 2 * SEALED))).rejects.toThrow('could not be decrypted at chunk 1');
    });

    it('refuses an archive with a chunk added to its end', async () => {
        const sealed: Buffer = await encrypt(randomBytes((2 * CHUNK) + 5));

        await expect(decrypt(Buffer.concat([sealed, sealed.subarray(0, SEALED)]))).rejects.toThrow('could not be decrypted at chunk 2');
    });

    it('refuses chunks in a different order', async () => {
        const sealed: Buffer = await encrypt(randomBytes(3 * CHUNK));
        const swapped: Buffer = Buffer.concat([
            sealed.subarray(SEALED, 2 * SEALED),
            sealed.subarray(0, SEALED),
            sealed.subarray(2 * SEALED)
        ]);

        await expect(decrypt(swapped)).rejects.toThrow('could not be decrypted at chunk 0');
    });

    it('refuses a different key', async () => {
        const sealed: Buffer = await encrypt(randomBytes(10));

        await expect(decrypt(sealed, BackupEncryptionUtilities.generateKey())).rejects.toThrow('could not be decrypted at chunk 0');
    });

    it('hands out a chunk only once it is authenticated', async () => {
        const data: Buffer = randomBytes(3 * CHUNK);
        const sealed: Buffer = await encrypt(data);
        sealed.writeUInt8(sealed.readUInt8(SEALED + 10) ^ 1, SEALED + 10);

        const received: Buffer[] = [];
        await expect((async () => {
            for await (const part of BackupEncryptionUtilities.decrypt(inPieces(sealed), key)) {
                received.push(part);
            }
        })()).rejects.toThrow('could not be decrypted at chunk 1');

        // the first chunk and nothing of the second, which is why a restore stages the whole archive
        // before any of it reaches the resource
        expect(Buffer.concat(received).equals(data.subarray(0, CHUNK))).toBe(true);
    });
});