import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { ZipTestEntry, ZipTestUtilities } from '../__testing__/zip-test.utilities';
import { ZipEntry, ZipUtilities } from './zip.utilities';

async function* piecesOf(...pieces: Buffer[]): AsyncGenerator<Buffer> {
    for (const piece of pieces) {
        yield await Promise.resolve(piece);
    }
}

async function* entriesOf(...entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
    for (const entry of entries) {
        yield await Promise.resolve(entry);
    }
}

async function pack(...entries: ZipEntry[]): Promise<Buffer> {
    const pieces: Buffer[] = [];
    for await (const piece of ZipUtilities.pack(entriesOf(...entries))) {
        pieces.push(piece);
    }
    return Buffer.concat(pieces);
}

const modifiedAt: Date = new Date('2026-11-24T10:20:30.000Z');

describe('ZipUtilities', () => {
    it('writes every file as it comes, read back byte for byte by the central directory', async () => {
        const large: Buffer = randomBytes(3 * 1024 * 1024);
        const archive: Buffer = await pack(
            { name: 'index.xml', modifiedAt, content: piecesOf(Buffer.from('<?xml version="1.0"?><DataSet/>')) },
            { name: 'empty.csv', modifiedAt, content: piecesOf() },
            { name: 'documents/Quittung März.pdf', modifiedAt, content: piecesOf(large.subarray(0, 1000), large.subarray(1000)) }
        );

        const entries: ZipTestEntry[] = ZipTestUtilities.unpack(archive);
        expect(entries.map(e => [e.name, e.utf8, e.content.length])).toEqual([
            ['index.xml', true, 31],
            ['empty.csv', true, 0],
            ['documents/Quittung März.pdf', true, large.length]
        ]);
        expect(entries[0]?.content.toString()).toBe('<?xml version="1.0"?><DataSet/>');
        expect(entries[2]?.content.equals(large)).toBe(true);
        // starts with a local header and ends with the end record
        expect(archive.readUInt32LE(0)).toBe(0x04034B50);
        expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054B50);
    });

    it('deflates what compresses', async () => {
        const text: Buffer = Buffer.from('"1200";"Bank";"ASSET"\r\n'.repeat(10_000));

        const archive: Buffer = await pack({ name: 'accounts.csv', modifiedAt, content: piecesOf(text) });

        expect(archive.length).toBeLessThan(text.length / 10);
        expect(ZipTestUtilities.unpack(archive)[0]?.content.equals(text)).toBe(true);
    });

    it('writes an empty archive', async () => {
        const archive: Buffer = await pack();

        expect(archive.length).toBe(22);
        expect(ZipTestUtilities.unpack(archive)).toEqual([]);
    });

    it('fails with what reading a file fails with', async () => {
        async function* failing(): AsyncGenerator<Buffer> {
            yield await Promise.resolve(Buffer.from('a'));
            throw new Error('The store is gone.');
        }

        await expect(pack({ name: 'a.txt', modifiedAt, content: failing() })).rejects.toThrow('The store is gone.');
    });
});