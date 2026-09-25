import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { FsUtilities } from '../../../utilities/fs.utilities';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.9.
 *
 * Deliberately a *multi tier* cache: an in-memory L1 over a valkey L2 that every instance shares.
 * A single tier cache on the valkey store would be coherent across instances all by itself - the
 * values live on the server, so invalidating anywhere removes them for everybody - and a single
 * tier in-memory cache going stale is not a defect, it is what in-memory means. Neither would say
 * anything about the framework.
 *
 * The multi tier arrangement is the one that cannot be configured out of trouble, and it is the
 * arrangement multi tier exists for. Invalidating on one instance clears its L1 and the shared L2,
 * and every other instance's L1 keeps answering with the old value for the full ttl. No choice of
 * store fixes that: being local is what L1 is.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'caching.instance-options.ts'),
        instances: 2
    });
}, 15000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * Reads the value the given instance currently believes.
 * @param baseUrl - The instance to ask.
 * @returns What it answered.
 */
async function readValue(baseUrl: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/cluster-cache/value`);
    expect(res.status).toBe(200);
    return Number(await res.text());
}

describe('evaluation/04-infrastructure-subsystems 1.9 - a local cache tier across replicas', () => {

    it('stops serving a value that another replica invalidated', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        await running.clearMarks();

        // both replicas read the value, so both now hold it in their own L1. The second one gets it
        // from the shared L2 and back-fills its L1 from there, which is what makes it stale later.
        expect(await readValue(first.baseUrl)).toBe(0);
        expect(await readValue(second.baseUrl)).toBe(0);

        // a write lands on one replica, which then invalidates the tag - exactly what a write path
        // does after changing the data behind a cached read
        const bumped: Response = await fetch(`${first.baseUrl}/cluster-cache/bump`, { method: 'POST' });
        expect(bumped.status).toBe(204);
        const invalidated: Response = await fetch(`${first.baseUrl}/cluster-cache/invalidate`, { method: 'POST' });
        expect(invalidated.status).toBe(204);

        // control: the replica that handled the invalidation sees the new value, which also proves
        // the shared L2 really was cleared. If this fails the fixture is broken rather than the
        // framework, and the assertion below means nothing.
        expect(await readValue(first.baseUrl)).toBe(1);

        // and so must every other replica. Waited for rather than read once: instances are told
        // through the data source rather than in the same breath, so invalidation is eventually
        // consistent across a deployment by design. Eventually is the assertion - never is the bug.
        const settled: number = await running.waitFor(
            async () => await readValue(second.baseUrl),
            value => value === 1,
            { timeoutInMs: 10000 }
        );
        expect(settled).toBe(1);
        // above the usual 15000: the wait is bounded by a real poll interval on another instance
    }, 25000);
});