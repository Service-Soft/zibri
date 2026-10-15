import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { baselineUserEmail, baselineUserPassword } from './baseline.instance-options';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';

/**
 * The control for the cluster harness.
 *
 * Every other cluster test asserts fixed behavior and is therefore red until a finding is closed.
 * This one is expected to pass, and it is the reason those reds can be believed: it proves that the
 * instances really booted as separate processes, that each one can be addressed individually, and
 * that they really do share a single data source the parent can read.
 *
 * If this file goes red, nothing else in the cluster suite means anything - fix this first.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'baseline.instance-options.ts'),
        instances: 2
    });
}, 15000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

describe('cluster harness', () => {

    it('boots instances that each answer http under their own identity', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        expect(cluster.instances).toHaveLength(2);

        const answers: string[] = await Promise.all(
            cluster.instances.map(async instance => {
                const res: Response = await fetch(`${instance.baseUrl}/cluster-baseline/who`);
                expect(res.status).toBe(200);
                return await res.text();
            })
        );

        // each instance answers with its own id, on its own port. Two identical answers would mean
        // the parent is talking to one process twice, which is exactly what this file rules out.
        for (const [i, instance] of cluster.instances.entries()) {
            expect(answers[i]).toContain(instance.id);
        }
        expect(new Set(answers).size).toBe(2);
    }, 15000);

    it('has every instance writing to the one data source the parent reads', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        for (const instance of cluster.instances) {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-baseline/mark`, { method: 'POST' });
            expect(res.status).toBe(200);
        }

        // read straight out of the container, not through any instance: the observation shares no
        // code path with what wrote the rows
        const marks: ClusterMarkRow[] = await cluster.marks('baseline');
        const writers: string[] = marks.map(m => m.instanceId);

        expect(marks).toHaveLength(2);
        expect(writers).toEqual(expect.arrayContaining(cluster.instances.map(i => i.id)));
    }, 15000);

    it('accepts a caller on one instance once another one logged them in', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        // 204 because the route hands nothing back, which is what the framework answers for a
        // handler with no body rather than a 200 nobody can tell from an empty one
        expect((await fetch(`${first.baseUrl}/cluster-baseline/user/shared`, { method: 'POST' })).status).toBe(204);
        const loggedIn: Response = await fetch(`${first.baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ email: baselineUserEmail('shared'), password: baselineUserPassword })
        });
        expect(loggedIn.status).toBe(200);
        const { accessToken }: { accessToken: { value: string } } = await loggedIn.json() as { accessToken: { value: string } };

        const res: Response = await fetch(`${second.baseUrl}/cluster-baseline/me`, {
            headers: { authorization: `Bearer ${accessToken.value}` }
        });

        // the instances are replicas of one application, and a token is issued and verified under
        // that application's name - so replicas named after themselves refuse each other's callers.
        // Every scenario that logs in against one instance and calls another then fails as "not
        // logged in", which reads like anything except a naming problem.
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(second.id);
    }, 15000);

    it('reports what an instance was doing when it dies unexpectedly', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const victim: string = cluster.instanceAt(cluster.instances.length - 1).id;

        // a crash, not a shutdown - this is how the worker pool and event replay findings will be
        // driven, so the harness has to survive one and still be usable afterwards
        await cluster.kill(victim, 'SIGKILL');
        await cluster.scaleTo(2);

        expect(cluster.instances).toHaveLength(2);
        expect(cluster.instances.map(i => i.id)).not.toContain(victim);

        const res: Response = await fetch(`${cluster.instanceAt(1).baseUrl}/cluster-baseline/who`);
        expect(res.status).toBe(200);
    }, 15000);
});