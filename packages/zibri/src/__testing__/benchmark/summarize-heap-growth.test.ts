import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { testFileFolder } from '../constants';

/**
 * How `scripts/summarize-heap-growth.mjs` tells what a process came to hold between two snapshots of
 * it, and what holds it.
 */

const scriptPath: string = path.resolve(__dirname, '..', '..', '..', 'scripts', 'summarize-heap-growth.mjs');
const folder: FsPath = FsUtilities.getPath(testFileFolder, `heap-growth-${UUIDUtilities.generate()}`);
const before: FsPath = FsUtilities.getPath(folder, 'before.heapsnapshot');
const after: FsPath = FsUtilities.getPath(folder, 'after.heapsnapshot');

describe('summarizing what a process came to hold', () => {
    let summary: string;

    beforeAll(async () => {
        await FsUtilities.mkdir(folder);
        // in a process of its own, small enough to snapshot in a moment: 64 buffers of 64 KiB, held
        // by a part kept in an array that was there before
        execFileSync(process.execPath, [
            '--input-type=module', '--eval', `
            import v8 from 'node:v8';
            class UploadPart {
                constructor(chunks) {
                    this.chunks = chunks;
                }
            }
            globalThis.keptParts = [];
            v8.writeHeapSnapshot(${JsonUtilities.stringify(before)});
            globalThis.keptParts.push(new UploadPart(Array.from({ length: 64 }, () => Buffer.alloc(64 * 1024, 1))));
            v8.writeHeapSnapshot(${JsonUtilities.stringify(after)});
        `
        ], { stdio: 'ignore' });
        summary = execFileSync(process.execPath, [scriptPath, before, after], { encoding: 'utf8' });
    }, 60_000);

    afterAll(async () => {
        await FsUtilities.rm(folder);
    });

    it('counts the bytes that were not there before', () => {
        const newMib: number = Number(/^\s*([\d.]+) MiB {2}in \d+ new objects/.exec(summary)?.[1]);

        expect(newMib).toBeGreaterThanOrEqual(4);
        // the buffers and what holds them, not the process the snapshot was taken of
        expect(newMib).toBeLessThan(5);
    });

    it('names the object of the first snapshot they hang from, and the path to it', () => {
        const holders: string = summary.slice(summary.indexOf('by what holds them'));
        // the largest holder first, ending in the array that was there before and the part put into it
        const largest: string[] = holders.split('\n').slice(1)
            .filter(line => line !== '');

        // the path to the holder, then the one inside it, up to the next holder
        const insideAt: number = holders.indexOf('and inside it');
        const holder: string = holders.slice(0, insideAt);
        const inside: string = holders.slice(insideAt).split(/\n\s+\d+\.\d MiB/)[0] ?? '';

        expect(largest[0]).toMatch(/^\s*4\.\d MiB/);
        expect(holder).toContain('keptParts → Array');
        // the part put into the array, and the buffer behind one of its chunks
        expect(inside).toContain('[0] → UploadPart');
        expect(inside).toContain('chunks → Array');
        expect(inside).toContain('system / JSArrayBufferData');
    });
});