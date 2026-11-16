import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { afterAll, describe, expect, it } from '@jest/globals';

import { FsPath, FsUtilities } from './fs.utilities';
import { TarEntry, TarUtilities } from './tar.utilities';
import { UUIDUtilities } from './uuid.utilities';
import { testFileFolder } from '../__testing__/constants';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `tar-${UUIDUtilities.generate()}`);

// eslint-disable-next-line typescript/require-await
async function* fromBuffers(entries: { name: string, content: Buffer }[]): AsyncGenerator<TarEntry> {
    for (const entry of entries) {
        yield {
            name: entry.name,
            size: entry.content.length,
            modifiedAt: new Date('2026-11-12T10:00:00.000Z'),
            // eslint-disable-next-line typescript/require-await
            content: (async function* content(): AsyncGenerator<Buffer> {
                // in two pieces, as a file read from disk comes
                yield entry.content.subarray(0, 3);
                yield entry.content.subarray(3);
            })()
        };
    }
}

async function pack(entries: { name: string, content: Buffer }[]): Promise<Buffer> {
    const pieces: Buffer[] = [];
    for await (const piece of TarUtilities.pack(fromBuffers(entries))) {
        pieces.push(piece);
    }
    return Buffer.concat(pieces);
}

/**
 * The header an archive gives a file of the given size: the first piece written, before its content is read.
 * @param size - The size of the file.
 * @returns The header.
 */
async function resolveHeaderOf(size: number): Promise<Buffer> {
    // eslint-disable-next-line typescript/require-await
    const entries: AsyncGenerator<TarEntry> = (async function* entries(): AsyncGenerator<TarEntry> {
        yield { name: 'large.jsonl', size, modifiedAt: new Date('2026-11-12T10:00:00.000Z'), content: Readable.from([]) };
    })();
    for await (const piece of TarUtilities.pack(entries)) {
        return piece;
    }
    throw new Error('The archive holds no header.');
}

afterAll(async () => {
    await FsUtilities.rm(folder);
});

describe('TarUtilities', () => {
    it('writes an archive the system tar lists and extracts as it was written', async () => {
        // eslint-disable-next-line cspell/spellchecker
        const bytes: Buffer = Buffer.from([0, 1, 2, 253, 254, 255, ...Buffer.from('a line\nüñïcode')]);
        const archive: Buffer = await pack([
            { name: 'manifest.json', content: Buffer.from('{"formatVersion":1}') },
            { name: 'task.jsonl', content: bytes },
            // exactly a block, which needs no padding
            { name: 'block.bin', content: Buffer.alloc(512, 7) }
        ]);
        await FsUtilities.mkdir(folder);
        const archivePath: FsPath = FsUtilities.getPath(folder, 'export.tar');
        await writeFile(archivePath, archive);

        expect(archive.length % 512).toBe(0);
        expect(execFileSync('tar', ['-tf', archivePath]).toString()
            .trim()
            .split('\n')).toStrictEqual(['manifest.json', 'task.jsonl', 'block.bin']);
        expect(execFileSync('tar', ['-xOf', archivePath, 'task.jsonl'])).toStrictEqual(bytes);
        expect(execFileSync('tar', ['-xOf', archivePath, 'block.bin'])).toStrictEqual(Buffer.alloc(512, 7));
    });

    // the 11 octal digits of the size end at 8 GiB, and a larger file was refused once its header was due
    it('writes the size of a file of 8 GiB or more in the base-256 form of GNU tar, and a smaller one in octal', async () => {
        const gib8: number = 8 * (1024 ** 3);
        const large: Buffer = await resolveHeaderOf(gib8 + 5);
        const largest: Buffer = await resolveHeaderOf(gib8 - 1);

        expect(large[124]).toBe(0x80);
        expect(large.subarray(125, 128)).toStrictEqual(Buffer.alloc(3));
        expect(large.readBigUInt64BE(128)).toBe(BigInt(gib8 + 5));
        // summed with its own field as spaces, the high bit of the size included
        const summed: Buffer = Buffer.from(large).fill(' ', 148, 156);
        expect(Number.parseInt(large.toString('ascii', 148, 154), 8)).toBe(summed.reduce((sum, byte) => sum + byte, 0));
        expect(largest.toString('ascii', 124, 136)).toBe('77777777777\u0000');
    });

    it('refuses a file whose content does not come to its size, and a name longer than a header holds', async () => {
        // eslint-disable-next-line typescript/require-await
        const short: AsyncGenerator<TarEntry> = (async function* entries(): AsyncGenerator<TarEntry> {
            yield {
                name: 'short.txt',
                size: 10,
                modifiedAt: new Date(),
                // eslint-disable-next-line typescript/require-await
                content: (async function* content(): AsyncGenerator<Buffer> {
                    yield Buffer.from('abc');
                })()
            };
        })();
        const read: () => Promise<void> = async () => {
            for await (const piece of TarUtilities.pack(short)) {
                void piece;
            }
        };
        await expect(read()).rejects.toThrow('holds 3 bytes');
        await expect(pack([{ name: `${'x'.repeat(101)}.txt`, content: Buffer.from('a') }])).rejects.toThrow('longer than a tar header holds');
        await expect(pack([{ name: `${'f'.repeat(156)}/${'x'.repeat(10)}.txt`, content: Buffer.from('a') }])).rejects.toThrow('longer than a tar header holds');
    });

    // the folder of a data source before a table name of 63 bytes outgrew the name field
    it('writes a path longer than the name field with its folders in the prefix field, which the system tar puts back together', async () => {
        const path: string = `${'Data'.repeat(15)}DataSource/${'t'.repeat(63)}.jsonl`;
        const archive: Buffer = await pack([{ name: path, content: Buffer.from('a line\n') }]);
        await FsUtilities.mkdir(folder);
        const archivePath: FsPath = FsUtilities.getPath(folder, 'long-path.tar');
        await writeFile(archivePath, archive);

        expect(Buffer.byteLength(path)).toBeGreaterThan(100);
        expect(execFileSync('tar', ['-tf', archivePath]).toString()
            .trim()).toBe(path);
        expect(execFileSync('tar', ['-xOf', archivePath, path]).toString()).toBe('a line\n');
    });
});