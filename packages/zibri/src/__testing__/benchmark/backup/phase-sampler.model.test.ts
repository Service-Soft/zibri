import { setTimeout as wait } from 'node:timers/promises';

import { afterEach, describe, expect, it } from '@jest/globals';

import { PhaseMeasurement } from './backup-measurement.model';
import { PhaseSampler } from './phase-sampler.model';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { testFileFolder } from '../../constants';

/**
 * How long one collection of the stand-in collector blocks, about what a collection of a running application takes.
 */
const COLLECTION_MS: number = 20;

/**
 * How long the work of a measured phase keeps its thread busy, many clock ticks of 10 ms.
 */
const BUSY_MS: number = 300;

describe('PhaseSampler', () => {
    const collector: NodeJS.GCFunction | undefined = globalThis.gc;

    afterEach(() => {
        globalThis.gc = collector;
    });

    // a short phase waiting on another process, as a backup waits on postgres, runs on while the sampler
    // collects: a reading that waited its whole interval after its collections read a phase of 257 ms 4 times
    it('reads a live phase about as often as its interval says, however long its collections take', async () => {
        // eslint-disable-next-line typescript/require-await
        globalThis.gc = async () => {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, COLLECTION_MS);
        };
        // never created: a folder that does not exist holds nothing
        const sampler: PhaseSampler = new PhaseSampler(FsUtilities.getPath(testFileFolder, `phase-sampler-${UUIDUtilities.generate()}`), undefined);

        sampler.begin({ intervalInMs: 50, name: 'phase' });
        await wait(1000);
        const phase: PhaseMeasurement = await sampler.end();

        // 20 at an interval of 50 ms, and 11 when each reading adds its two collections to it
        expect(phase.live?.readings).toBeGreaterThanOrEqual(16);
    });

    // the CPU time of a phase counted V8's own threads, which collect what the whole process holds and spend on
    // the same restore of 10 MB 50 ms one time and 200 the next: of the same code, the figure came out 1.39x apart
    (process.platform === 'linux' ? it : it.skip)('tells what the threads of V8 spent from what the rest of the process spent', async () => {
        const sampler: PhaseSampler = new PhaseSampler(FsUtilities.getPath(testFileFolder, `phase-sampler-${UUIDUtilities.generate()}`), undefined);

        sampler.begin(undefined);
        // what leaves the collector work to do, which its helpers do beside the thread allocating
        const busyUntil: number = performance.now() + BUSY_MS;
        let held: Buffer[] = [];
        while (performance.now() < busyUntil) {
            held.push(Buffer.alloc(1024));
            if (held.length > 100_000) {
                held = [];
            }
        }
        const phase: PhaseMeasurement = await sampler.end();

        const total: number = phase.cpuUserMs + phase.cpuSystemMs;
        expect(phase.cpuByThreadMs?.v8).toBeGreaterThan(0);
        expect(phase.cpuWithoutV8Ms).toBeGreaterThanOrEqual(BUSY_MS / 2);
        expect(phase.cpuWithoutV8Ms).toBeLessThan(total);
        expect(phase.cpuWithoutV8Ms).toBeCloseTo(phase.cpuMainThreadMs + (phase.cpuByThreadMs?.pool ?? 0) + (phase.cpuByThreadMs?.other ?? 0), 6);
    });
});