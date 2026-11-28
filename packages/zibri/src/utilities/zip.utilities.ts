import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw, type DeflateRaw } from 'node:zlib';

import { InternalError } from '../error-handling/internal-error.model';

/**
 * The largest number the 4 bytes of a size or an offset hold, which marks one written in a zip64 field instead.
 */
const MAX_UINT32: number = 0xFFFFFFFF;

/**
 * The largest number of entries the 2 bytes of the end record hold.
 */
const MAX_UINT16: number = 0xFFFF;

/**
 * The version of the zip format a reader needs: 2.0 for deflated files and data descriptors, 4.5 for zip64.
 */
const VERSION: number = 20;
const ZIP64_VERSION: number = 45;

/**
 * The general purpose flags of every file: its sizes and checksum in a data descriptor after it (bit 3), as they are
 * known only once it is written, and its name in UTF-8 (bit 11).
 */
const FLAGS: number = 0x0808;

/**
 * Deflate, which every reader of zip archives reads.
 */
const DEFLATE: number = 8;

/**
 * A file of a zip archive, with what it holds.
 */
export type ZipEntry = {
    /**
     * Its path in the archive, with `/` between its folders, such as `documents/receipt.pdf`.
     */
    name: string,
    /**
     * When it was last changed.
     */
    modifiedAt: Date,
    /**
     * What it holds, read once, when the entry is written.
     */
    content: AsyncIterable<Buffer>
};

/**
 * What the central directory at the end of an archive records of a file.
 */
type WrittenEntry = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    name: Buffer,
    // eslint-disable-next-line jsdoc/require-jsdoc
    time: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    date: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    crc: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    compressedSize: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    size: number,
    /**
     * Where its local header starts in the archive.
     */
    offset: number
};

/**
 * Writes zip archives as they are read, each file deflated, without holding a file in memory. A file is below 4 GiB,
 * and the archive is of any size: past 4 GiB or 65,535 files it ends with the records of zip64, which the zip readers
 * of Windows, macOS and Linux read.
 */
export abstract class ZipUtilities {
    /**
     * Writes an archive of the given files, one after another as they come.
     * @param entries - The files.
     * @yields The archive.
     * @throws When a file holds 4 GiB or more.
     */
    static async* pack(entries: AsyncIterable<ZipEntry>): AsyncGenerator<Buffer> {
        const written: WrittenEntry[] = [];
        let offset: number = 0;
        for await (const entry of entries) {
            const name: Buffer = Buffer.from(entry.name, 'utf8');
            const [time, date] = this.resolveDosTime(entry.modifiedAt);
            const header: Buffer = this.resolveLocalHeader(name, time, date);
            yield header;

            let crc: number = 0;
            let size: number = 0;
            let compressedSize: number = 0;
            const deflate: DeflateRaw = createDeflateRaw();
            const counted: AsyncGenerator<Buffer> = (async function* count(): AsyncGenerator<Buffer> {
                for await (const piece of entry.content) {
                    crc = crc32(piece, crc);
                    size += piece.length;
                    yield piece;
                }
            })();
            // read from while it is fed: what the deflate stream holds is what it is behind, never the whole file
            const fed: Promise<void> = pipeline(counted, deflate);
            // awaited below, or surfaced by the reading, which fails with what failed the feeding
            // eslint-disable-next-line promise/prefer-await-to-then -- marks the rejection handled while the reading runs, as it is awaited only after
            fed.catch(() => undefined);
            for await (const piece of deflate) {
                const compressed: Buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
                compressedSize += compressed.length;
                yield compressed;
            }
            await fed;
            if (size >= MAX_UINT32 || compressedSize >= MAX_UINT32) {
                throw new InternalError(`The file "${entry.name}" of a zip archive holds 4 GiB or more, which the archive does not take.`);
            }
            yield this.resolveDataDescriptor(crc, compressedSize, size);
            written.push({ name, time, date, crc, compressedSize, size, offset });
            offset += header.length + compressedSize + 16;
        }
        const directory: Buffer[] = written.map(entry => this.resolveCentralHeader(entry));
        const directorySize: number = directory.reduce((sum, header) => sum + header.length, 0);
        yield* directory;
        yield* this.resolveEnd(written.length, directorySize, offset);
    }

    private static resolveLocalHeader(name: Buffer, time: number, date: number): Buffer {
        const header: Buffer = Buffer.alloc(30);
        header.writeUInt32LE(0x04034B50, 0);
        header.writeUInt16LE(VERSION, 4);
        header.writeUInt16LE(FLAGS, 6);
        header.writeUInt16LE(DEFLATE, 8);
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        // the checksum and the sizes follow the file, in its data descriptor
        header.writeUInt16LE(name.length, 26);
        return Buffer.concat([header, name]);
    }

    private static resolveDataDescriptor(crc: number, compressedSize: number, size: number): Buffer {
        const descriptor: Buffer = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074B50, 0);
        descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(compressedSize, 8);
        descriptor.writeUInt32LE(size, 12);
        return descriptor;
    }

    private static resolveCentralHeader(entry: WrittenEntry): Buffer {
        // a file starting past 4 GiB has its offset in a zip64 field, and the version needed to read that
        const zip64: boolean = entry.offset >= MAX_UINT32;
        const extra: Buffer = Buffer.alloc(zip64 ? 12 : 0);
        if (zip64) {
            extra.writeUInt16LE(0x0001, 0);
            extra.writeUInt16LE(8, 2);
            extra.writeBigUInt64LE(BigInt(entry.offset), 4);
        }
        const header: Buffer = Buffer.alloc(46);
        header.writeUInt32LE(0x02014B50, 0);
        header.writeUInt16LE(zip64 ? ZIP64_VERSION : VERSION, 4);
        header.writeUInt16LE(zip64 ? ZIP64_VERSION : VERSION, 6);
        header.writeUInt16LE(FLAGS, 8);
        header.writeUInt16LE(DEFLATE, 10);
        header.writeUInt16LE(entry.time, 12);
        header.writeUInt16LE(entry.date, 14);
        header.writeUInt32LE(entry.crc, 16);
        header.writeUInt32LE(entry.compressedSize, 20);
        header.writeUInt32LE(entry.size, 24);
        header.writeUInt16LE(entry.name.length, 28);
        header.writeUInt16LE(extra.length, 30);
        header.writeUInt32LE(zip64 ? MAX_UINT32 : entry.offset, 42);
        return Buffer.concat([header, entry.name, extra]);
    }

    /**
     * The records ending an archive: those of zip64 first when its files, the size or the start of its central
     * directory are beyond what the end record holds.
     * @param count - How many files it holds.
     * @param directorySize - How many bytes its central directory takes.
     * @param directoryOffset - Where its central directory starts.
     * @returns The records.
     */
    private static resolveEnd(count: number, directorySize: number, directoryOffset: number): Buffer[] {
        const zip64: boolean = count >= MAX_UINT16 || directorySize >= MAX_UINT32 || directoryOffset >= MAX_UINT32;
        const res: Buffer[] = [];
        if (zip64) {
            const record: Buffer = Buffer.alloc(56);
            record.writeUInt32LE(0x06064B50, 0);
            // the size of the record after these 12 bytes
            record.writeBigUInt64LE(44n, 4);
            record.writeUInt16LE(ZIP64_VERSION, 12);
            record.writeUInt16LE(ZIP64_VERSION, 14);
            record.writeBigUInt64LE(BigInt(count), 24);
            record.writeBigUInt64LE(BigInt(count), 32);
            record.writeBigUInt64LE(BigInt(directorySize), 40);
            record.writeBigUInt64LE(BigInt(directoryOffset), 48);
            const locator: Buffer = Buffer.alloc(20);
            locator.writeUInt32LE(0x07064B50, 0);
            locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8);
            locator.writeUInt32LE(1, 16);
            res.push(record, locator);
        }
        const end: Buffer = Buffer.alloc(22);
        end.writeUInt32LE(0x06054B50, 0);
        end.writeUInt16LE(Math.min(count, MAX_UINT16), 8);
        end.writeUInt16LE(Math.min(count, MAX_UINT16), 10);
        end.writeUInt32LE(Math.min(directorySize, MAX_UINT32), 12);
        end.writeUInt32LE(Math.min(directoryOffset, MAX_UINT32), 16);
        res.push(end);
        return res;
    }

    /**
     * The time and the date of a moment as a zip archive holds them, in the fields of MS-DOS: to the second rounded
     * down to an even one, from 1980 on, read as UTC.
     * @param moment - The moment.
     * @returns The time and the date.
     */
    private static resolveDosTime(moment: Date): [number, number] {
        const year: number = Math.max(moment.getUTCFullYear(), 1980);
        const time: number = (moment.getUTCHours() << 11) | (moment.getUTCMinutes() << 5) | Math.floor(moment.getUTCSeconds() / 2);
        const date: number = ((year - 1980) << 9) | ((moment.getUTCMonth() + 1) << 5) | moment.getUTCDate();
        return [time, date];
    }
}