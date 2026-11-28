import { crc32, inflateRawSync } from 'node:zlib';

/**
 * A file read from a zip archive.
 */
export type ZipTestEntry = {
    /**
     * Its path in the archive.
     */
    name: string,
    /**
     * Whether its name is flagged as UTF-8.
     */
    utf8: boolean,
    /**
     * What it holds.
     */
    content: Buffer
};

/**
 * Reads zip archives in tests the way an unzip tool does: by the central directory at their end, each file inflated
 * and checked against the checksum and the size the directory records.
 */
export abstract class ZipTestUtilities {
    /**
     * Reads every file of an archive.
     * @param archive - The archive.
     * @returns Its files, in the order of its central directory.
     * @throws When the archive has no end record, or a file does not match what the directory records of it.
     */
    static unpack(archive: Buffer): ZipTestEntry[] {
        const end: number = archive.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
        if (end === -1) {
            throw new Error('The zip archive has no end record.');
        }
        let count: number = archive.readUInt16LE(end + 10);
        let offset: number = archive.readUInt32LE(end + 16);
        // the zip64 end record, which the locator before the end record points at
        const locator: number = end - 20;
        if (locator >= 0 && archive.readUInt32LE(locator) === 0x07064B50) {
            const record: number = Number(archive.readBigUInt64LE(locator + 8));
            count = Number(archive.readBigUInt64LE(record + 32));
            offset = Number(archive.readBigUInt64LE(record + 48));
        }
        const res: ZipTestEntry[] = [];
        for (let index: number = 0; index < count; index++) {
            if (archive.readUInt32LE(offset) !== 0x02014B50) {
                throw new Error(`The central directory of the zip archive is broken at its file ${index}.`);
            }
            const flags: number = archive.readUInt16LE(offset + 8);
            const method: number = archive.readUInt16LE(offset + 10);
            const crc: number = archive.readUInt32LE(offset + 16);
            const compressedSize: number = archive.readUInt32LE(offset + 20);
            const size: number = archive.readUInt32LE(offset + 24);
            const nameLength: number = archive.readUInt16LE(offset + 28);
            const extraLength: number = archive.readUInt16LE(offset + 30);
            const commentLength: number = archive.readUInt16LE(offset + 32);
            const name: string = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
            let localOffset: number = archive.readUInt32LE(offset + 42);
            if (localOffset === 0xFFFFFFFF) {
                localOffset = Number(archive.readBigUInt64LE(offset + 46 + nameLength + 4));
            }
            const dataStart: number = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
            const raw: Buffer = archive.subarray(dataStart, dataStart + compressedSize);
            const content: Buffer = method === 8 ? inflateRawSync(raw) : raw;
            if (content.length !== size || crc32(content) !== crc) {
                throw new Error(`The file "${name}" of the zip archive does not match its checksum or its size.`);
            }
            res.push({ name, utf8: (flags & 0x0800) !== 0, content });
            offset += 46 + nameLength + extraLength + commentLength;
        }
        return res;
    }
}