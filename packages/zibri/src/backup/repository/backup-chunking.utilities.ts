import { hkdfSync } from 'node:crypto';

import { BackupChunkingOptions } from './backup-chunking-options.model';
import { BackupManifestUtilities } from './backup-manifest.utilities';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * How many bits the gear hash keeps of the bytes it saw: one per byte, so a boundary depends on the
 * last 32 bytes and on nothing before them.
 */
const GEAR_HASH_BITS: number = 32;

/**
 * How many more mask bits a chunk is cut with before its average size, and how many fewer after it.
 *
 * FastCDC's normalized chunking: a boundary is harder to find early and easier to find late, which
 * keeps the sizes close to the average without moving any boundary that the content decides.
 */
const NORMALIZATION_BITS: number = 2;

/**
 * Cuts the data of a resource into chunks whose boundaries its content decides, so that an insert or
 * a delete changes the chunks around it and no others.
 */
export abstract class BackupChunkingUtilities {
    /**
     * The table the gear hash looks each byte up in.
     *
     * Derived from a key, so that whoever cannot read the chunks cannot compute where a known file would
     * be cut either, and cannot recognize it by the sizes of the chunks it would make.
     * @param key - The key, or undefined for the table of unencrypted chunks, which are readable anyway.
     * @returns One value per byte.
     */
    static resolveGearTable(key: Buffer | undefined): Int32Array {
        const bytes: ArrayBuffer = hkdfSync('sha256', key ?? Buffer.alloc(0), '', 'zibri backup chunk boundaries', 256 * 4);
        return new Int32Array(bytes);
    }

    /**
     * Checks that the options can cut chunks.
     * @param options - The options.
     * @throws When the sizes are not ordered, the average is not a power of two, or the level is not one
     * zstd has.
     */
    static validateOptions(options: BackupChunkingOptions): void {
        const { minChunkBytes, averageChunkBytes, maxChunkBytes, compressionLevel } = options;
        const problems: string[] = [];
        if (!Number.isInteger(minChunkBytes) || minChunkBytes < BackupManifestUtilities.SMALLEST_CHUNK_BYTES) {
            problems.push(`minChunkBytes needs to be a whole number of at least ${BackupManifestUtilities.SMALLEST_CHUNK_BYTES}.`);
        }
        // the strict mask takes more bits than the average, which the hash has to have
        const largestAverage: number = 2 ** (GEAR_HASH_BITS - NORMALIZATION_BITS);
        if (!Number.isInteger(Math.log2(averageChunkBytes)) || averageChunkBytes > largestAverage) {
            problems.push(`averageChunkBytes needs to be a power of two of at most ${largestAverage}.`);
        }
        if (!(minChunkBytes < averageChunkBytes && averageChunkBytes < maxChunkBytes) || !Number.isInteger(maxChunkBytes)) {
            problems.push('minChunkBytes, averageChunkBytes and maxChunkBytes need to be whole numbers, each larger than the one before.');
        }
        if (!Number.isInteger(compressionLevel) || compressionLevel < 1 || compressionLevel > 19) {
            problems.push('compressionLevel needs to be a whole number from 1 to 19.');
        }
        if (problems.length) {
            throw new InternalError(['The options of the backup chunking are not usable:', ...problems]);
        }
    }

    /**
     * Cuts data into chunks.
     * @param source - The data.
     * @param gear - The table of {@link resolveGearTable}.
     * @param options - The sizes.
     * @yields Each chunk, in order. Every chunk but the last holds at least `minChunkBytes`, and none
     * more than `maxChunkBytes`. Nothing for data without a byte.
     */
    // one loop over every byte a backup stores: split into helpers, the hash of each byte would go through
    // a call or an object instead of a local, on the path the benchmarks hold to the release
    // eslint-disable-next-line sonar/cognitive-complexity
    static async* cut(
        source: AsyncIterable<unknown> | Iterable<unknown>,
        gear: Int32Array,
        options: Pick<BackupChunkingOptions, 'minChunkBytes' | 'averageChunkBytes' | 'maxChunkBytes'>
    ): AsyncGenerator<Buffer> {
        const { minChunkBytes, averageChunkBytes, maxChunkBytes } = options;
        const averageBits: number = Math.log2(averageChunkBytes);
        // the high bits of the hash, which the most bytes have shifted through
        const strictMask: number = this.resolveMask(averageBits + NORMALIZATION_BITS);
        const looseMask: number = this.resolveMask(averageBits - NORMALIZATION_BITS);

        let pieces: Buffer[] = [];
        let length: number = 0;
        let hash: number = 0;
        for await (const value of source) {
            const data: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
            let start: number = 0;
            let position: number = 0;
            while (position < data.length) {
                // nothing before the smallest size can be a boundary, so it is not hashed: the hash at it
                // starts from nothing, which is what a boundary there depends on
                if (length < minChunkBytes) {
                    const taken: number = Math.min(minChunkBytes - length, data.length - position);
                    position += taken;
                    length += taken;
                    continue;
                }
                const mask: number = length < averageChunkBytes ? strictMask : looseMask;
                // up to the next point where the mask or the chunk ends, whichever is first
                const end: number = Math.min(
                    data.length,
                    position + (length < averageChunkBytes ? averageChunkBytes : maxChunkBytes) - length
                );
                let cutAt: number = -1;
                for (let i: number = position; i < end; i++) {
                    hash = ((hash << 1) + (gear[data[i] ?? 0] ?? 0)) | 0;
                    if ((hash & mask) === 0) {
                        cutAt = i + 1;
                        break;
                    }
                }
                const scannedTo: number = cutAt === -1 ? end : cutAt;
                length += scannedTo - position;
                position = scannedTo;
                if (cutAt !== -1 || length >= maxChunkBytes) {
                    pieces.push(data.subarray(start, position));
                    yield pieces.length === 1 ? pieces[0] ?? Buffer.alloc(0) : Buffer.concat(pieces, length);
                    pieces = [];
                    length = 0;
                    hash = 0;
                    start = position;
                }
            }
            if (start < data.length) {
                pieces.push(data.subarray(start));
            }
        }
        if (length) {
            yield pieces.length === 1 ? pieces[0] ?? Buffer.alloc(0) : Buffer.concat(pieces, length);
        }
    }

    private static resolveMask(bits: number): number {
        return (((2 ** bits) - 1) * (2 ** (GEAR_HASH_BITS - bits))) | 0;
    }
}