import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { BackupManifestEntry } from './backup-manifest-entry.model';
import { BackupManifestUtilities } from './backup-manifest.utilities';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { BackupStoredResource } from './backup-stored-resource.model';

const KEY: BackupRepositoryKey = { id: '0b8f3c2e-6f1d-4a57-9a3e-2d4c1b0e7f65', idKey: randomBytes(32), dataKey: randomBytes(32) };

/**
 * Bytes handed over in pieces of a given size, the way a store's stream hands them over.
 * @param bytes - The bytes.
 * @param pieceBytes - How large each piece is.
 * @yields Each piece.
 */
async function* inPieces(bytes: Buffer, pieceBytes: number): AsyncGenerator<Buffer> {
    for (let i: number = 0; i < bytes.length; i += pieceBytes) {
        yield await Promise.resolve(bytes.subarray(i, i + pieceBytes));
    }
}

/**
 * Some chunks, as a manifest lists them.
 * @param count - How many.
 * @returns The chunks.
 */
function resolveEntries(count: number): BackupManifestEntry[] {
    return Array.from({ length: count }, (_, i) => ({ id: randomBytes(32).toString('hex'), length: 1024 + i }));
}

/**
 * The chunks a stored manifest lists, read the way a restore reads it.
 * @param stored - The manifest as it was stored.
 * @param key - The key it was encrypted with.
 * @returns The key id it names and its chunks.
 */
async function readEntries(stored: Buffer, key: BackupRepositoryKey | undefined): Promise<[string | undefined, BackupManifestEntry[]]> {
    const read: BackupStoredResource = await BackupManifestUtilities.read(inPieces(stored, 7));
    if (read.kind !== 'chunks') {
        throw new Error(`read as ${read.kind}`);
    }
    return [read.keyId, await BackupManifestUtilities.decodeEntries(read.body, key)];
}

describe('BackupManifestUtilities', () => {
    it('reads back the chunks of a manifest, encrypted and not, with the key it names', async () => {
        const entries: BackupManifestEntry[] = resolveEntries(5000);

        expect(await readEntries(await BackupManifestUtilities.encodeChunks(entries, KEY), KEY)).toEqual([KEY.id, entries]);
        expect(await readEntries(await BackupManifestUtilities.encodeChunks(entries, undefined), undefined)).toEqual([undefined, entries]);
        expect(await readEntries(await BackupManifestUtilities.encodeChunks([], KEY), KEY)).toEqual([KEY.id, []]);
    });

    it('seals the same manifest to other bytes each time, so no key is used twice', async () => {
        const entries: BackupManifestEntry[] = resolveEntries(3);

        const first: Buffer = await BackupManifestUtilities.encodeChunks(entries, KEY);
        const second: Buffer = await BackupManifestUtilities.encodeChunks(entries, KEY);

        expect(first.equals(second)).toBe(false);
    });

    it('refuses an encrypted manifest that was changed where it is stored, or that another key opens', async () => {
        const stored: Buffer = await BackupManifestUtilities.encodeChunks(resolveEntries(3), KEY);
        const changed: Buffer = Buffer.from(stored);
        changed[changed.length - 30] = (changed[changed.length - 30] ?? 0) ^ 1;

        await expect(readEntries(changed, KEY)).rejects.toThrow('could not be decrypted');
        await expect(readEntries(stored, { ...KEY, dataKey: randomBytes(32) })).rejects.toThrow('could not be decrypted');
    });

    it('hands over the data that follows the header of a resource in one piece, byte for byte', async () => {
        const data: Buffer = randomBytes(100_000);

        const read: BackupStoredResource = await BackupManifestUtilities.read(
            inPieces(Buffer.concat([BackupManifestUtilities.resolveWholeHeader(), data]), 1)
        );
        if (read.kind !== 'whole') {
            throw new Error(`read as ${read.kind}`);
        }
        const pieces: Buffer[] = [];
        for await (const piece of read.data) {
            pieces.push(piece);
        }

        expect(Buffer.concat(pieces).equals(data)).toBe(true);
    });

    it('refuses an object in a shape this build does not read', async () => {
        await expect(BackupManifestUtilities.read(inPieces(Buffer.from([9, 1, 2, 3]), 4))).rejects.toThrow('which this build does not read');
        await expect(BackupManifestUtilities.read(inPieces(Buffer.from([1, 9]), 4))).rejects.toThrow('a kind this build does not read');
        await expect(BackupManifestUtilities.read(inPieces(Buffer.alloc(0), 4))).rejects.toThrow('which this build does not read');
    });

    it('allows a manifest of a resource cut into the smallest chunks there can be', async () => {
        const size: number = 10 * 1024 * 1024;
        const count: number = Math.ceil(size / BackupManifestUtilities.SMALLEST_CHUNK_BYTES);

        const stored: Buffer = await BackupManifestUtilities.encodeChunks(resolveEntries(count), KEY);

        expect(stored.length).toBeLessThanOrEqual(BackupManifestUtilities.resolveMaxBytes(size));
        expect(BackupManifestUtilities.resolveMaxBytes(size)).toBeGreaterThanOrEqual(size + 2);
    });
});