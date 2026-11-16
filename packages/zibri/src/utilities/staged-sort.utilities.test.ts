import { readdir, readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from '@jest/globals';

import { FsPath, FsUtilities } from './fs.utilities';
import { StagedSortLimits } from './staged-sort-limits.model';
import { StagedSortUtilities } from './staged-sort.utilities';
import { UUIDUtilities } from './uuid.utilities';
import { testFileFolder } from '../__testing__/constants';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `staged-sort-${UUIDUtilities.generate()}`);

/**
 * Names in pages, in the order they are given.
 * @param names - The names.
 * @param pageSize - How many a page holds.
 * @yields The pages.
 */
async function* toPages(names: string[], pageSize: number = 250): AsyncGenerator<string[]> {
    for (let i: number = 0; i < names.length; i += pageSize) {
        yield await Promise.resolve(names.slice(i, i + pageSize));
    }
}

async function findRunFiles(): Promise<string[]> {
    return await FsUtilities.exists(folder) ? await readdir(folder) : [];
}

/**
 * More names than one run holds, in no order, some of them twice.
 * @returns The names.
 */
function resolveManyNames(): string[] {
    const names: string[] = Array.from({ length: 120_000 }, () => `app:task:${UUIDUtilities.generate()}`);
    return [...names, ...names.slice(0, 500)];
}

afterAll(async () => {
    await FsUtilities.rm(folder);
});

describe('StagedSortUtilities', () => {
    it('sorts more names than it holds at once, each once, in pages', async () => {
        const names: string[] = resolveManyNames();
        const pages: string[][] = [];

        for await (const page of StagedSortUtilities.sortNames(toPages(names), folder, 1000)) {
            pages.push(page);
        }

        const expected: string[] = [...new Set(names)].sort();
        expect(pages.flat()).toEqual(expected);
        expect(pages.slice(0, -1).every(page => page.length === 1000)).toBe(true);
    }, 60000);

    // each run merged is a file open and a buffer held, so that a merge of all of them grows with the names
    it('merges no more runs at once than it may, however many it wrote, and sorts them all', async () => {
        const names: string[] = Array.from({ length: 3000 }, () => `app:task:${UUIDUtilities.generate()}`);
        names.push(...names.slice(0, 100));
        // about ten names a run, so some three hundred runs, merged four at a time over several passes
        const limits: StagedSortLimits = { runBytes: 1024, maxRunsMerged: 4 };
        const sorted: string[] = [];
        let filesAtFirstPage: number | undefined;

        for await (const page of StagedSortUtilities.sortNames(toPages(names, 50), folder, 100, limits)) {
            filesAtFirstPage ??= (await findRunFiles()).length;
            sorted.push(...page);
        }

        expect(filesAtFirstPage).toBeGreaterThan(1);
        expect(filesAtFirstPage).toBeLessThanOrEqual(4);
        expect(sorted).toEqual([...new Set(names)].sort());
        expect(await findRunFiles()).toEqual([]);
    }, 60000);

    it('sorts fewer names than a run in memory, writing nothing', async () => {
        const sorted: string[] = [];
        for await (const page of StagedSortUtilities.sortNames(toPages(['b', 'a', 'c', 'a']), folder, 2)) {
            sorted.push(...page);
            expect(await findRunFiles()).toEqual([]);
        }

        expect(sorted).toEqual(['a', 'b', 'c']);
    });

    // a name can hold what a row holds, such as a unique email address
    it('writes no name readably to disk, and deletes its runs once it is done or stopped', async () => {
        const marked: string = 'app:user:unique:email:ada@example.com';
        const names: string[] = [...resolveManyNames(), marked];

        for await (const page of StagedSortUtilities.sortNames(toPages(names), folder, 1000)) {
            const files: string[] = await findRunFiles();
            expect(files.length).toBeGreaterThan(1);
            for (const file of files) {
                expect((await readFile(FsUtilities.getPath(folder, file))).includes('ada@example.com')).toBe(false);
            }
            expect(page.length).toBe(1000);
            break;
        }

        expect(await findRunFiles()).toEqual([]);
    }, 60000);

    it('hands back names holding line breaks and characters beyond ascii as they were', async () => {
        const odd: string[] = ['app:note:line\nbreak', 'app:note:"quoted"', 'app:note:grüße', 'app:note:日本'];
        const names: string[] = [...resolveManyNames(), ...odd];
        const sorted: string[] = [];

        for await (const page of StagedSortUtilities.sortNames(toPages(names), folder, 1000)) {
            sorted.push(...page);
        }

        expect(sorted.filter(name => odd.includes(name)).sort()).toEqual([...odd].sort());
    }, 60000);
});