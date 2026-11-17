import { InternalError } from '../error-handling/internal-error.model';

/**
 * How large a block of a tar archive is: every header, and every file padded to a whole number of them.
 */
const BLOCK_BYTES: number = 512;

/**
 * The longest name a ustar header holds without its prefix field.
 */
const MAX_NAME_BYTES: number = 100;

/**
 * The longest prefix a ustar header holds: the folders of a path whose name alone is too long.
 */
const MAX_PREFIX_BYTES: number = 155;

/**
 * Where the prefix field of a ustar header starts.
 */
const PREFIX_OFFSET: number = 345;

/**
 * The first size the 11 octal digits of a ustar header no longer hold, 8 GiB.
 */
const MAX_OCTAL_SIZE: number = 8 ** 11;

/**
 * A file of a tar archive, with what it holds.
 */
export type TarEntry = {
    /**
     * Its path in the archive: at most 100 bytes after its last folders, and at most 155 bytes of those.
     */
    name: string,
    /**
     * How many bytes it holds, which its content has to come to.
     */
    size: number,
    /**
     * When it was last changed.
     */
    modifiedAt: Date,
    /**
     * What it holds.
     */
    content: AsyncIterable<Buffer>
};

/**
 * Writes tar archives in the ustar format, which every tar reads. A file of 8 GiB or more has its size in
 * the base-256 form of GNU tar, which the tar of Linux, macOS and Windows reads.
 */
export abstract class TarUtilities {
    /**
     * Writes an archive of the given files, one after another as they come.
     * @param entries - The files.
     * @yields The archive.
     * @throws When a file's content does not come to its size, or its name is too long.
     */
    static async* pack(entries: AsyncIterable<TarEntry>): AsyncGenerator<Buffer> {
        for await (const entry of entries) {
            yield this.resolveHeader(entry);
            let written: number = 0;
            for await (const piece of entry.content) {
                written += piece.length;
                yield piece;
            }
            if (written !== entry.size) {
                throw new InternalError(
                    `The file "${entry.name}" of a tar archive holds ${written} bytes, and its header says ${entry.size}.`
                );
            }
            const padding: number = (BLOCK_BYTES - (written % BLOCK_BYTES)) % BLOCK_BYTES;
            if (padding) {
                yield Buffer.alloc(padding);
            }
        }
        // the end of an archive: two blocks of zeros
        yield Buffer.alloc(BLOCK_BYTES * 2);
    }

    private static resolveHeader(entry: TarEntry): Buffer {
        const [name, prefix] = this.resolveNameFields(entry.name);
        const header: Buffer = Buffer.alloc(BLOCK_BYTES);
        name.copy(header, 0);
        prefix.copy(header, PREFIX_OFFSET);
        this.writeOctal(header, 100, 8, 0o644);
        this.writeOctal(header, 108, 8, 0);
        this.writeOctal(header, 116, 8, 0);
        this.writeSize(header, entry.size);
        this.writeOctal(header, 136, 12, Math.floor(entry.modifiedAt.getTime() / 1000));
        // a regular file
        header.write('0', 156, 'ascii');
        header.write('ustar\u000000', 257, 'ascii');
        // the checksum is summed with its own field as spaces
        header.fill(' ', 148, 156);
        const checksum: number = header.reduce((sum, byte) => sum + byte, 0);
        header.write(`${checksum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');
        return header;
    }

    /**
     * The name field of a path and its prefix field: a path longer than the name field holds is split at a
     * slash, its folders before it in the prefix, as every ustar reader puts them back together.
     * @param path - The path.
     * @returns The name and the prefix, empty when the name holds all of it.
     * @throws When no slash splits it into parts the two fields hold.
     */
    private static resolveNameFields(path: string): [Buffer, Buffer] {
        const bytes: Buffer = Buffer.from(path, 'utf8');
        if (bytes.length <= MAX_NAME_BYTES) {
            return [bytes, Buffer.alloc(0)];
        }
        const slash: number = 0x2F;
        for (let at: number = bytes.indexOf(slash); at > 0 && at <= MAX_PREFIX_BYTES; at = bytes.indexOf(slash, at + 1)) {
            if (bytes.length - at - 1 <= MAX_NAME_BYTES) {
                return [bytes.subarray(at + 1), bytes.subarray(0, at)];
            }
        }
        throw new InternalError(
            `The name "${path}" is longer than a tar header holds: ${MAX_NAME_BYTES} bytes after its last folders,`
            + ` and ${MAX_PREFIX_BYTES} of those.`
        );
    }

    private static writeSize(header: Buffer, size: number): void {
        if (size < MAX_OCTAL_SIZE) {
            this.writeOctal(header, 124, 12, size);
            return;
        }
        // 11 octal digits end at 8 GiB: beyond, the GNU base-256 form, a first byte with its high bit set and
        // the size in binary, big-endian, in the rest of the field. Any number fits in its last 8 bytes,
        // and the 3 before them stay 0
        header[124] = 0x80;
        header.writeBigUInt64BE(BigInt(size), 128);
    }

    private static writeOctal(header: Buffer, offset: number, length: number, value: number): void {
        const digits: string = value.toString(8).padStart(length - 1, '0');
        if (digits.length > length - 1) {
            throw new InternalError(`${value} is larger than a field of a tar header holds.`);
        }
        header.write(`${digits}\u0000`, offset, 'ascii');
    }
}