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

    /**
     * Reads an archive in the ustar format, such as one {@link pack} wrote, a file at a time: each file is handed
     * over before the one after it is read, and what the handler leaves of its content unread is passed over.
     * Entries other than files, such as folders, are passed over.
     * @param archive - The archive.
     * @param onEntry - Called with each file in turn, and awaited before the next one is read.
     * @throws When the archive ends inside a file or its header, or a header is not one of a tar archive.
     */
    static async unpack(archive: AsyncIterable<unknown>, onEntry: (entry: TarEntry) => Promise<void>): Promise<void> {
        const source: AsyncIterator<unknown> = archive[Symbol.asyncIterator]();
        let pending: Buffer = Buffer.alloc(0);
        // as many bytes as are there up to the given number, without waiting for more: none only at the end
        const readUpTo: (max: number) => Promise<Buffer> = async max => {
            while (!pending.length) {
                const next: IteratorResult<unknown> = await source.next();
                if (next.done === true) {
                    return Buffer.alloc(0);
                }
                pending = Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value));
            }
            const piece: Buffer = pending.subarray(0, max);
            pending = pending.subarray(piece.length);
            return piece;
        };
        // the given number of bytes, or fewer when the archive ends before them
        const readExactly: (length: number) => Promise<Buffer> = async length => {
            const pieces: Buffer[] = [];
            for (let read: number = 0; read < length;) {
                const piece: Buffer = await readUpTo(length - read);
                if (!piece.length) {
                    break;
                }
                pieces.push(piece);
                read += piece.length;
            }
            return Buffer.concat(pieces);
        };
        try {
            for (;;) {
                const header: Buffer = await readExactly(BLOCK_BYTES);
                // the end: a block of zeros, or nothing after the last file
                if (!header.length || header.every(byte => byte === 0)) {
                    return;
                }
                if (header.length < BLOCK_BYTES || !this.hasValidChecksum(header)) {
                    throw new InternalError('The tar archive holds a header that is cut short or damaged.');
                }
                const name: string = this.readName(header);
                const size: number = this.readSize(header);
                let remaining: number = size;
                // one position in the archive, however many readers of it there are: the handler's, and the one
                // passing over what it left
                const readContent: () => AsyncGenerator<Buffer> = async function* readContent(): AsyncGenerator<Buffer> {
                    while (remaining > 0) {
                        const piece: Buffer = await readUpTo(remaining);
                        if (!piece.length) {
                            throw new InternalError(`The tar archive ends inside the file "${name}".`);
                        }
                        remaining -= piece.length;
                        yield piece;
                    }
                };
                // '0', or NUL of the archives before ustar
                if (header[156] === 0x30 || header[156] === 0) {
                    await onEntry({ name, size, modifiedAt: new Date(this.readOctal(header, 136, 12) * 1000), content: readContent() });
                }
                for await (const piece of readContent()) {
                    void piece;
                }
                const padding: number = (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
                if ((await readExactly(padding)).length < padding) {
                    throw new InternalError(`The tar archive ends inside the file "${name}".`);
                }
            }
        }
        finally {
            await source.return?.();
        }
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

    private static hasValidChecksum(header: Buffer): boolean {
        // summed with its own field as spaces, as it is written
        const summed: number = Buffer.from(header).fill(' ', 148, 156)
            .reduce((sum, byte) => sum + byte, 0);
        return this.readOctal(header, 148, 8) === summed;
    }

    /**
     * The path of a file of an archive: its name field, after its prefix field when that holds its folders.
     * @param header - The header of the file.
     * @returns The path.
     */
    private static readName(header: Buffer): string {
        const name: string = this.readText(header, 0, MAX_NAME_BYTES);
        const prefix: string = this.readText(header, PREFIX_OFFSET, MAX_PREFIX_BYTES);
        return prefix ? `${prefix}/${name}` : name;
    }

    private static readSize(header: Buffer): number {
        // the base-256 form of GNU tar, which writeSize writes from 8 GiB on
        if ((header[124] ?? 0) & 0x80) {
            const size: bigint = header.readBigUInt64BE(128);
            if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new InternalError('The tar archive holds a file larger than can be read.');
            }
            return Number(size);
        }
        return this.readOctal(header, 124, 12);
    }

    private static readText(header: Buffer, offset: number, length: number): string {
        const field: Buffer = header.subarray(offset, offset + length);
        const end: number = field.indexOf(0);
        return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
    }

    private static readOctal(header: Buffer, offset: number, length: number): number {
        // ended by NUL or a space, and padded with either by some writers
        const digits: string = header.toString('ascii', offset, offset + length).replaceAll(/[\u0000 ]/g, '');
        if (!/^[0-7]+$/.test(digits)) {
            throw new InternalError('The tar archive holds a header that is cut short or damaged.');
        }
        return Number.parseInt(digits, 8);
    }
}