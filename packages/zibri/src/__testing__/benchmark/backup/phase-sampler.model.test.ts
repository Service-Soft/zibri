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

describe('PhaseSampler', () => {
    const collector: NodeJS.GCFunction | undefined = globalThis.gc;

    afterEach(() => {
        globalThis.gc = collector;
    });

    // a short phase waiting on another process, as a backup waits on postgres, runs on while the sampler
    // collects: a reading that waited its whole interval after its collections read a phase of 257 ms 4 times
    it('reads a live phase about as often as its interval says, however long its collections take', async () => {
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
});
