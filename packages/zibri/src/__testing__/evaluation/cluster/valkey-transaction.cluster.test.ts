import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { FsUtilities } from '../../../utilities/fs.utilities';

/**
 * Executable form of evaluation/10-leases-and-claims.md step 3 - a valkey transaction holding a
 * grant for its lifetime.
 *
 * A valkey transaction buffers its writes and applies them in one batch on commit. That is atomic,
 * but on its own it is not isolated: nothing is visible until the commit, so two replicas can each
 * buffer a write of the same row and whichever commits last silently overwrites the other. The fix
 * is a grant per row key, taken as the write is buffered and held until the transaction ends.
 *
 * The second case is what that alone does not buy, and is step 4. A grant taken at write time cannot
 * protect a value that was read before it - three replicas each adding one still land on 1, and the
 * same lost update happens on postgres under READ COMMITTED. The answer on both stores is `upsert`,
 * which holds from before the read rather than from the write.
 *
 * Every expectation describes the fixed behavior. See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'valkey-transaction.instance-options.ts'),
        instances: 3
    });
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * The most replicas that had the same row buffered at the same time.
 *
 * Reconstructed from the marks rather than measured, because no instance can see the others. Walking
 * them in the order they were written, an enter raises the occupancy and an exit lowers it. One is a
 * transaction that serializes; anything above one is two replicas holding a write of the same row,
 * one of which is about to be lost with no error anywhere.
 * @param marks - Every transaction mark, oldest first.
 * @returns The peak occupancy.
 */
function peakOccupancy(marks: ClusterMarkRow[]): number {
    let inside: number = 0;
    let peak: number = 0;
    for (const mark of marks) {
        inside += mark.kind === 'tx-enter' ? 1 : -1;
        peak = Math.max(peak, inside);
    }
    return peak;
}

/**
 * Reads the transaction marks, oldest first.
 * @param startedCluster - The cluster to read from.
 * @returns The enter and exit marks interleaved in the order they were written.
 */
async function transactionMarks(startedCluster: StartedTestCluster): Promise<ClusterMarkRow[]> {
    const marks: ClusterMarkRow[] = await startedCluster.marks();
    return marks.filter(m => m.kind === 'tx-enter' || m.kind === 'tx-exit');
}

/**
 * Puts the contended row back to zero.
 * @param startedCluster - The cluster to reset in.
 */
async function reset(startedCluster: StartedTestCluster): Promise<void> {
    await startedCluster.clearMarks();
    const [first] = startedCluster.instances;
    const res: Response = await fetch(`${first?.baseUrl}/cluster-valkey-transaction/reset`, { method: 'POST' });
    expect(res.status).toBe(204);
}

describe('evaluation/10-leases-and-claims - a valkey transaction across replicas', () => {

    it('does not let two replicas hold a write of the same row at once', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        await reset(cluster);

        // all three at once, which is the contention the grant is for. Each stays inside its
        // transaction well past the point the others arrive, so without a grant all three would be
        // holding a buffered write of this row simultaneously.
        await Promise.all(cluster.instances.map(async (instance: ClusterInstance) => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-valkey-transaction/write`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        const marks: ClusterMarkRow[] = await transactionMarks(cluster);
        expect(marks.filter(m => m.kind === 'tx-enter')).toHaveLength(cluster.instances.length);

        // the whole of what step 3 promises: two transactions writing the same key run one after the
        // other, which is what a row lock gives on a real database
        expect(peakOccupancy(marks)).toBe(1);
    }, 40000);

    it('does not lose an update when replicas read, add and write back concurrently', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        await reset(cluster);

        // three replicas each adding one to the same row, through an upsert. Written as a read, an
        // add and a write instead, every one of them would read zero and write one: the grant that a
        // buffered write takes serializes the writes but cannot un-read a value that was already
        // stale by the time it was taken.
        await Promise.all(cluster.instances.map(async (instance: ClusterInstance) => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-valkey-transaction/increment`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        const first: ClusterInstance = cluster.instanceAt(0);
        const res: Response = await fetch(`${first?.baseUrl}/cluster-valkey-transaction/record-value`, { method: 'POST' });
        expect(res.status).toBe(204);

        const recorded: ClusterMarkRow[] = (await cluster.marks()).filter(m => m.kind === 'counter-value');
        expect(recorded).toHaveLength(1);

        // three replicas each added one, so three is the only correct answer. One would be every
        // replica having read the same zero - three writes, two of them gone, nothing raised anywhere.
        expect(recorded[0]?.tag).toBe(String(cluster.instances.length));
    }, 40000);
});