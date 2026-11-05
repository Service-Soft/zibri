import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * A scheduled job is work the cluster owes once. Three replicas of a service that bills customers,
 * sends a reminder or closes an accounting period have to produce one of each, not three.
 *
 * Each replica delays its run by up to a second, which is not mutual exclusion - it only makes a
 * collision harder to reproduce by hand, which is why this needs several real processes.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'cron.instance-options.ts'),
        instances: 3
    });
}, TestTimeouts.resolveCluster(3, 'postgres').start);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, TestTimeouts.resolveCluster(3, 'postgres').shutdown);

describe('cron across replicas', () => {

    it('fires a scheduled job once across the cluster, not once per replica', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;

        // start from the assembled cluster: instance-0 has been firing this job since its own
        // init(), while the other two were still booting, and those runs would look like correct
        // single replica behavior
        await running.clearMarks();

        // three ticks rather than two: the newest one may still have runs in flight when the wait
        // ends, so it gets dropped below. Dropping it out of two would leave a single sample.
        const marks: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('cron'),
            rows => new Set(rows.map(r => r.tag)).size >= 3,
            // three scheduled ticks at a three second period, plus the random delay on the last one
            { timeoutInMs: 20000 }
        );

        const ticks: string[] = [...new Set(marks.map(m => m.tag))].sort();
        const newestTick: string | undefined = ticks.at(-1);
        assert(newestTick, 'no tick was recorded');

        const writersByTick: Map<string, string[]> = new Map();
        for (const mark of marks) {
            if (mark.tag === newestTick) {
                continue;
            }
            writersByTick.set(mark.tag, [...writersByTick.get(mark.tag) ?? [], mark.instanceId]);
        }

        // guard: with fewer than two settled ticks the assertion below would say almost nothing
        expect(writersByTick.size).toBeGreaterThanOrEqual(2);

        // one replica per tick. All three running every tick would bill every customer of a nightly
        // invoice job three times and send a reminder mail three times.
        const duplicated: [string, string[]][] = [...writersByTick.entries()].filter(([, writers]) => writers.length > 1);
        expect(duplicated).toEqual([]);
        // above the usual 15000 on purpose: this test cannot be faster than the schedule it
        // observes. It waits for three real ticks at a three second period, so the floor is about
        // nine seconds of doing nothing, and the wait above is allowed 20000 of it.
    }, 30000);

    it('stops a job on every replica once one disabled it, and runs it again once another enabled it', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;

        // the other replicas used to keep their own task running, so the job went on once per slot
        // while its row said INACTIVE
        expect((await fetch(`${running.instanceAt(0).baseUrl}/cluster-cron/disable`, { method: 'POST' })).status).toBe(204);
        // a run already past its claim when the job was disabled may still write its mark
        await new Promise(resolve => setTimeout(resolve, 4500));
        await running.clearMarks();
        // two slots at a three second period, plus the random delay
        await new Promise(resolve => setTimeout(resolve, 7500));
        expect(await running.marks('cron')).toEqual([]);

        // the replicas whose task was stopped learn of it at their next sync
        expect((await fetch(`${running.instanceAt(1).baseUrl}/cluster-cron/enable`, { method: 'POST' })).status).toBe(204);
        const marks: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('cron'),
            rows => rows.length > 0,
            // the five second sync, a three second slot and the random delay
            { timeoutInMs: 15000 }
        );
        expect(marks.length).toBeGreaterThan(0);
    }, 40000);
});