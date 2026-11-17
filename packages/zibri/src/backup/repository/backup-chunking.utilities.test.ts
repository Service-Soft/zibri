import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { BackupChunkingOptions } from './backup-chunking-options.model';
import { BackupChunkingUtilities } from './backup-chunking.utilities';

// small sizes, so that a few MiB of data make hundreds of chunks
const SIZES: Pick<BackupChunkingOptions, 'minChunkBytes' | 'averageChunkBytes' | 'maxChunkBytes'> = {
    minChunkBytes: 2 * 1024,
    averageChunkBytes: 8 * 1024,
    maxChunkBytes: 32 * 1024
};

const KEY: Buffer = randomBytes(32);

const KEYED_GEAR: Int32Array = BackupChunkingUtilities.resolveGearTable(KEY);

/**
 * The chunks data is cut into, handed over in pieces of a given size.
 * @param data - The data.
 * @param pieceBytes - How large each piece the chunker is handed is.
 * @param gear - The table the boundaries are found with.
 * @returns The chunks.
 */
async function cut(data: Buffer, pieceBytes: number, gear: Int32Array = KEYED_GEAR): Promise<Buffer[]> {
    const pieces: Buffer[] = [];
    for (let i: number = 0; i < data.length; i += pieceBytes) {
        pieces.push(data.subarray(i, i + pieceBytes));
    }
    const chunks: Buffer[] = [];
    for await (const chunk of BackupChunkingUtilities.cut(pieces, gear, SIZES)) {
        chunks.push(chunk);
    }
    return chunks;
}

/**
 * What a chunk is told apart by.
 * @param chunk - The chunk.
 * @returns Its sha256.
 */
function digest(chunk: Buffer): string {
    return createHash('sha256').update(chunk)
        .digest('hex');
}

describe('BackupChunkingUtilities', () => {
    const data: Buffer = randomBytes(4 * 1024 * 1024);

    it('cuts data into chunks that make it up again, each within the sizes and about the average', async () => {
        const chunks: Buffer[] = await cut(data, 64 * 1024);

        expect(Buffer.concat(chunks).equals(data)).toBe(true);
        for (const chunk of chunks.slice(0, -1)) {
            expect(chunk.length).toBeGreaterThanOrEqual(SIZES.minChunkBytes);
            expect(chunk.length).toBeLessThanOrEqual(SIZES.maxChunkBytes);
        }
        const average: number = data.length / chunks.length;
        expect(average).toBeGreaterThan(SIZES.averageChunkBytes / 2);
        expect(average).toBeLessThan(SIZES.averageChunkBytes * 2);
    });

    it('cuts the same chunks however the data is handed over', async () => {
        const whole: string[] = (await cut(data, data.length)).map(digest);

        expect((await cut(data, 64 * 1024)).map(digest)).toEqual(whole);
        expect((await cut(data, 1000)).map(digest)).toEqual(whole);
        expect((await cut(data, 7)).map(digest)).toEqual(whole);
    });

    it('changes only the chunks around an insert, and those after it are the same again', async () => {
        const before: string[] = (await cut(data, 64 * 1024)).map(digest);
        const middle: number = data.length / 2;
        const inserted: Buffer = Buffer.concat([data.subarray(0, middle), Buffer.from('a row written in between'), data.subarray(middle)]);

        const after: string[] = (await cut(inserted, 64 * 1024)).map(digest);

        const unchanged: number = after.filter(d => before.includes(d)).length;
        // the chunk holding the insert, and at most the one the boundaries find their way back in
        expect(unchanged).toBeGreaterThanOrEqual(before.length - 2);
        expect(after.length - unchanged).toBeLessThanOrEqual(2);
    });

    it('cuts at boundaries the key decides, the same for the same key and others for another one', async () => {
        const sizes: number[] = (await cut(data, 64 * 1024)).map(c => c.length);

        const resolveSizes: (gear: Int32Array) => Promise<number[]> = async gear => (await cut(data, 64 * 1024, gear)).map(c => c.length);

        expect(await resolveSizes(BackupChunkingUtilities.resolveGearTable(Buffer.from(KEY)))).toEqual(sizes);
        expect(await resolveSizes(BackupChunkingUtilities.resolveGearTable(randomBytes(32)))).not.toEqual(sizes);
        expect(await resolveSizes(BackupChunkingUtilities.resolveGearTable(undefined))).not.toEqual(sizes);
    });

    it('cuts data the content never finds a boundary in at the largest size', async () => {
        const chunks: Buffer[] = await cut(Buffer.alloc(10 * SIZES.maxChunkBytes), 64 * 1024);

        expect(chunks.map(c => c.length)).toEqual(Array.from({ length: 10 }, () => SIZES.maxChunkBytes));
    });

    it('cuts nothing out of nothing, and one chunk out of less than the smallest size', async () => {
        expect(await cut(Buffer.alloc(0), 1)).toEqual([]);
        expect((await cut(data.subarray(0, 100), 64 * 1024)).map(c => c.length)).toEqual([100]);
    });

    it('refuses sizes that are not ordered, an average that is not a power of two, and a level zstd does not have', () => {
        const valid: BackupChunkingOptions = { minChunkBytes: 256 * 1024, averageChunkBytes: 1024 * 1024, maxChunkBytes: 4 * 1024 * 1024, compressionLevel: 3 };

        expect(() => BackupChunkingUtilities.validateOptions(valid)).not.toThrow();
        // below what a manifest is sized for
        expect(() => BackupChunkingUtilities.validateOptions({ ...valid, minChunkBytes: 1024 })).toThrow('needs to be a whole number of at least 16384');
        expect(() => BackupChunkingUtilities.validateOptions({ ...valid, averageChunkBytes: 10_000 })).toThrow('needs to be a power of two');
        expect(() => BackupChunkingUtilities.validateOptions({ ...valid, minChunkBytes: valid.averageChunkBytes })).toThrow('each larger than the one before');
        expect(() => BackupChunkingUtilities.validateOptions({ ...valid, compressionLevel: 0 })).toThrow('from 1 to 19');
    });
});