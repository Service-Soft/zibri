import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClusterInstance, ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { lockHoldInMs } from './lock.instance-options.ts';
import { FsUtilities } from '../../../utilities/fs.utilities.ts';

/**
 * Executable form of evaluation/10-leases-and-claims.md, the withLock half.
 *
 * ValKeyDataSource.withLock sets a key with a time to live and deletes it in a finally. Neither half
 * survives work that outlives the lease: the key expires while the holder is still inside, and the
 * unconditional delete then frees a lock that by that point belongs to somebody else. The second
 * part is what makes this worse than a missed exclusion - once the deletes are one holder out of
 * step they stay that way, so a single slow call degrades the lock for every later caller too.
 *
 * Everything the framework serializes across replicas goes through this, including the schema lock
 * that closed 01-data-layer.md C2.
 *
 * Every expectation describes the fixed behavior, so the slow half is red until the finding is
 * closed. See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'lock.instance-options.ts'),
        instances: 3
    });
}, 20000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * The most replicas that were inside the critical section at the same time.
 *
 * Reconstructed from the marks rather than measured, because no instance can see the others. Walking
 * them in the order they were written, an enter raises the occupancy and an exit lowers it, so the
 * highest the count ever reaches is how badly the lock was broken - one is a working lock, two is a
 * lost exclusion, three means a holder deleted a lock belonging to someone else.
 * @param marks - Every lock mark, oldest first.
 * @returns The peak occupancy.
 */
function peakOccupancy(marks: ClusterMarkRow[]): number {
    let inside: number = 0;
    let peak: number = 0;
    for (const mark of marks) {
        inside += mark.kind === 'lock-enter' ? 1 : -1;
        peak = Math.max(peak, inside);
    }
    return peak;
}

/**
 * Reads the lock marks, oldest first.
 * @param startedCluster - The cluster to read from.
 * @returns The enter and exit marks interleaved in the order they were written.
 */
async function lockMarks(startedCluster: StartedTestCluster): Promise<ClusterMarkRow[]> {
    const marks: ClusterMarkRow[] = await startedCluster.marks();
    return marks.filter(m => m.kind === 'lock-enter' || m.kind === 'lock-exit');
}

/**
 * Waits until every instance that entered the section has left it again.
 * @param startedCluster - The cluster to read from.
 * @param expected - How many instances were asked to enter.
 */
async function waitForCompletedSections(startedCluster: StartedTestCluster, expected: number): Promise<void> {
    await startedCluster.waitFor(
        async () => await lockMarks(startedCluster),
        marks => marks.filter(m => m.kind === 'lock-exit').length >= expected,
        { timeoutInMs: 40000 }
    );
}

describe('evaluation/10-leases-and-claims - withLock across replicas', () => {

    it('lets only one replica into the critical section at a time', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        await cluster.clearMarks();

        // all three at once, which is the contention the lock is for. The work fits inside the lease
        // comfortably, so this is the case withLock already handles - it is the control that proves
        // the fixture can observe a working lock at all.
        await Promise.all(cluster.instances.map(async (instance: ClusterInstance) => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-lock/quick`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        await waitForCompletedSections(cluster, cluster.instances.length);

        const marks: ClusterMarkRow[] = await lockMarks(cluster);
        expect(marks.filter(m => m.kind === 'lock-enter')).toHaveLength(cluster.instances.length);
        expect(peakOccupancy(marks)).toBe(1);
    }, 30000);

    it('keeps the critical section exclusive when the work outlives the lease', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        await cluster.clearMarks();

        // all three at once. Each section outlives the lock's own time to live several times over,
        // so every follower has to still be waiting long after the leader's key would have lapsed
        // on its own - which is exactly what a lock that renews itself is for.
        await Promise.all(cluster.instances.map(async (instance: ClusterInstance) => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-lock/slow`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        await waitForCompletedSections(cluster, cluster.instances.length);

        const marks: ClusterMarkRow[] = await lockMarks(cluster);
        expect(marks.filter(m => m.kind === 'lock-enter')).toHaveLength(cluster.instances.length);

        // a lock that expires under its holder is not a lock. The work being slow is not a caller
        // error - withLock takes a function and never says how long it may run for.
        expect(peakOccupancy(marks)).toBe(1);
        // longer than the usual 15000 on purpose: the section is deliberately slower than the lease,
        // and three replicas each sit in it for that long, one after another
    }, 60000);

    it('does not let a replica release a lock it no longer holds', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        await cluster.clearMarks();

        // two is enough to tell the two failures apart. If the first replica's lock lapses while it
        // works, the second takes it, and the first then runs its finally and deletes a key it no
        // longer owns - that is what made the failure compound rather than stay at one lost
        // exclusion. The second is started a beat later so the order of the marks is decided by the
        // lock rather than by which request happened to arrive first.
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        const firstDone: Promise<Response> = fetch(`${first.baseUrl}/cluster-lock/slow`, { method: 'POST' });
        await new Promise<void>(resolve => {
            setTimeout(resolve, lockHoldInMs / 2);
        });
        const secondDone: Promise<Response> = fetch(`${second.baseUrl}/cluster-lock/slow`, { method: 'POST' });

        await Promise.all([firstDone, secondDone]);
        await waitForCompletedSections(cluster, 2);

        const marks: ClusterMarkRow[] = await lockMarks(cluster);

        // the second replica has to still be holding the lock when it exits, which shows up as its
        // exit being the last mark rather than the first replica's delete having let it out early
        const entries: string[] = marks.map(m => `${m.instanceId} ${m.kind}`);
        expect(entries).toEqual([
            `${first.id} lock-enter`,
            `${first.id} lock-exit`,
            `${second.id} lock-enter`,
            `${second.id} lock-exit`
        ]);
    }, 60000);
});