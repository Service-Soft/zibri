import { writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FsPath, FsUtilities } from './fs.utilities.ts';
import { testFileFolder } from '../__testing__/constants.ts';

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'fs-utilities-test');

describe('FsUtilities', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(workDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(workDir);
    });

    describe('getPath', () => {
        it('joins path segments together', () => {
            expect(FsUtilities.getPath('a', 'b', 'c')).toBe('a/b/c');
        });

        it('preserves an absolute path', () => {
            expect(FsUtilities.getPath('/a', 'b')).toBe('/a/b');
        });

        it('normalizes ".." and "." segments', () => {
            expect(FsUtilities.getPath('a', 'b', '..', 'c')).toBe('a/c');
        });
    });

    describe('createReadStream', () => {
        it('hands out the bytes of a file that is not text', async () => {
            // an image being served, say: read as text, every byte that is not valid utf8 comes back as
            // the three bytes of a replacement character, and the file no longer matches its own size
            const bytes: Buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x80]);
            const p: FsPath = FsUtilities.getPath(workDir, 'binary');
            await writeFile(p, bytes);

            const read: Buffer[] = [];
            for await (const chunk of FsUtilities.createReadStream(p)) {
                read.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            }

            expect(Buffer.concat(read).equals(bytes)).toBe(true);
        });
    });

    describe('createFile / exists / readFile', () => {
        it('creates a new file with the given string content', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'created.txt');
            await FsUtilities.createFile(file, 'hello world');

            expect(await FsUtilities.exists(file)).toBe(true);
            expect(await FsUtilities.readFile(file)).toBe('hello world');
        });

        it('creates a new file from an array of lines, joined by newlines', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'created-lines.txt');
            await FsUtilities.createFile(file, ['line1', 'line2']);

            expect(await FsUtilities.readFile(file)).toBe('line1\nline2');
        });

        it('creates missing parent directories recursively by default', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'nested', 'deep', 'file.txt');
            await FsUtilities.createFile(file, 'nested content');

            expect(await FsUtilities.readFile(file)).toBe('nested content');
        });

        it('throws when the file already exists', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'duplicate.txt');
            await FsUtilities.createFile(file, 'first');

            await expect(FsUtilities.createFile(file, 'second')).rejects.toThrow(/already exists/);
        });

        it('reports false for a path that does not exist', async () => {
            expect(await FsUtilities.exists(FsUtilities.getPath(workDir, 'does-not-exist.txt'))).toBe(false);
        });
    });

    describe('createFileIfAbsent', () => {
        it('creates the file once when many create it at the same time, and leaves it whole', async () => {
            const folder: FsPath = FsUtilities.getPath(workDir, 'created-once');
            const file: FsPath = FsUtilities.getPath(folder, 'file.json');
            const contents: string[] = Array.from({ length: 20 }, (_, i) => `${String(i)}:${'x'.repeat(100000)}`);

            const created: boolean[] = await Promise.all(contents.map(async content => await FsUtilities.createFileIfAbsent(file, content)));

            expect(created.filter(Boolean)).toHaveLength(1);
            expect(contents).toContain(await FsUtilities.readFile(file));
            // nothing of the way there is left beside it
            expect(await FsUtilities.readdir(folder)).toHaveLength(1);
        });

        it('leaves a file that is there as it is', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'kept.txt');
            await FsUtilities.createFile(file, 'first');

            expect(await FsUtilities.createFileIfAbsent(file, 'second')).toBe(false);
            expect(await FsUtilities.readFile(file)).toBe('first');
        });
    });

    describe('updateFile', () => {
        it('throws when the file does not exist yet', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'not-created.txt');
            await expect(FsUtilities.updateFile(file, 'x', 'replace')).rejects.toThrow(/does not exist/);
        });

        it('replaces the entire content', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'update-replace.txt');
            await FsUtilities.createFile(file, 'old content');
            await FsUtilities.updateFile(file, 'new content', 'replace');

            expect(await FsUtilities.readFile(file)).toBe('new content');
        });

        it('appends to existing non-empty content', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'update-append.txt');
            await FsUtilities.createFile(file, 'line1');
            await FsUtilities.updateFile(file, 'line2', 'append');

            expect(await FsUtilities.readFile(file)).toBe('line1\nline2');
        });

        it('appending to an originally empty file does not leave a leading blank line', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'update-append-empty.txt');
            await FsUtilities.createFile(file, '');
            await FsUtilities.updateFile(file, 'first real line', 'append');

            expect(await FsUtilities.readFile(file)).toBe('first real line');
        });

        it('prepends to existing non-empty content', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'update-prepend.txt');
            await FsUtilities.createFile(file, 'line2');
            await FsUtilities.updateFile(file, 'line1', 'prepend');

            expect(await FsUtilities.readFile(file)).toBe('line1\nline2');
        });

        it('prepending to an originally empty file does not leave a trailing blank line', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'update-prepend-empty.txt');
            await FsUtilities.createFile(file, '');
            await FsUtilities.updateFile(file, 'only line', 'prepend');

            expect(await FsUtilities.readFile(file)).toBe('only line');
        });
    });

    describe('upsertFile', () => {
        it('creates the file when it does not exist yet', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'upsert-new.txt');
            await FsUtilities.upsertFile(file, 'created via upsert');

            expect(await FsUtilities.readFile(file)).toBe('created via upsert');
        });

        it('replaces the content when the file already exists', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'upsert-existing.txt');
            await FsUtilities.createFile(file, 'original');
            await FsUtilities.upsertFile(file, 'replaced via upsert');

            expect(await FsUtilities.readFile(file)).toBe('replaced via upsert');
        });
    });

    describe('rm', () => {
        it('removes an existing file', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'to-remove.txt');
            await FsUtilities.createFile(file, 'x');
            await FsUtilities.rm(file, false);

            expect(await FsUtilities.exists(file)).toBe(false);
        });

        it('does not throw when removing a path that does not exist', async () => {
            await expect(FsUtilities.rm(FsUtilities.getPath(workDir, 'never-existed.txt'))).resolves.toBeUndefined();
        });
    });

    describe('rmIfEmpty', () => {
        it('removes an empty directory', async () => {
            const dir: FsPath = FsUtilities.getPath(workDir, 'empty-dir');
            await FsUtilities.mkdir(dir);

            await FsUtilities.rmIfEmpty(dir);

            expect(await FsUtilities.exists(dir)).toBe(false);
        });

        it('keeps a directory that holds something, and what it holds', async () => {
            const file: FsPath = FsUtilities.getPath(workDir, 'full-dir', 'kept.txt');
            await FsUtilities.createFile(file, 'x');

            await FsUtilities.rmIfEmpty(FsUtilities.getPath(workDir, 'full-dir'));

            expect(await FsUtilities.readFile(file)).toBe('x');
        });

        it('does not throw for a directory that does not exist', async () => {
            await expect(FsUtilities.rmIfEmpty(FsUtilities.getPath(workDir, 'never-existed'))).resolves.toBeUndefined();
        });
    });

    describe('glob', () => {
        it('finds files matching a glob pattern', async () => {
            const globDir: FsPath = FsUtilities.getPath(workDir, 'glob-target');
            await FsUtilities.createFile(FsUtilities.getPath(globDir, 'a.txt'), 'a');
            await FsUtilities.createFile(FsUtilities.getPath(globDir, 'b.txt'), 'b');
            await FsUtilities.createFile(FsUtilities.getPath(globDir, 'c.md'), 'c');

            const found: FsPath[] = await FsUtilities.glob(`${globDir}/*.txt`);

            expect(found.sort()).toEqual([
                FsUtilities.getPath(globDir, 'a.txt'),
                FsUtilities.getPath(globDir, 'b.txt')
            ].sort());
        });

        it('respects an exclude pattern', async () => {
            const globDir: FsPath = FsUtilities.getPath(workDir, 'glob-exclude-target');
            await FsUtilities.createFile(FsUtilities.getPath(globDir, 'keep.txt'), 'a');
            await FsUtilities.createFile(FsUtilities.getPath(globDir, 'skip.txt'), 'b');

            const found: FsPath[] = await FsUtilities.glob({
                include: `${globDir}/*.txt`,
                exclude: `${globDir}/skip.txt`
            });

            expect(found).toEqual([FsUtilities.getPath(globDir, 'keep.txt')]);
        });
    });
});