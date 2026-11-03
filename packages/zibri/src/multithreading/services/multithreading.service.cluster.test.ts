import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { FsUtilities } from '../../utilities/fs.utilities';

/**
 * The queue is a table, so what it promises are claims about a cluster that cannot be observed in
 * one process: that a job queued on a busy instance is run by a free one, and that a job whose
 * instance stopped existing is taken over rather than left.
 *
 * Every instance here has exactly one worker for normal jobs. That is what makes the first half
 * decisive - a replica that is already busy cannot be the one that runs the next job, so if the job
 * runs at all, another replica ran it - and the fixture reports the id of the instance it ran on,
 * read from that process's own environment.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'multithreading.service.instance-options.ts'),
        instances: 2
    });
}, TestTimeouts.resolveCluster(2, 'postgres').start);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, TestTimeouts.resolveCluster(2, 'postgres').shutdown);

/**
 * Queues a job on the given instance.
 * @param baseUrl - The instance to queue it on.
 * @param durationInMs - How long the job should stay busy.
 * @returns The id of the queued job.
 */
async function queueOn(baseUrl: string, durationInMs: number): Promise<string> {
    const res: Response = await fetch(`${baseUrl}/cluster-jobs/queue/${durationInMs}`, { method: 'POST' });
    expect(res.status).toBe(200);
    return (await res.text()).replaceAll('"', '');
}

/**
 * Reads what a job's row says, through whichever instance is asked.
 * @param baseUrl - The instance to ask.
 * @param jobId - The job to read.
 * @returns The status and the id of the instance that ran it, as `status:result`.
 */
async function readJob(baseUrl: string, jobId: string): Promise<string> {
    const res: Response = await fetch(`${baseUrl}/cluster-jobs/${jobId}`);
    expect(res.status).toBe(200);
    return (await res.text()).replaceAll('"', '');
}

describe('the thread job queue across replicas', () => {

    it('runs a job on another replica when the one it was queued on is busy', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        // takes the first instance's only worker for the rest of this test
        const busyJobId: string = await queueOn(first.baseUrl, 4000);

        // and this one is queued on that same busy instance. Nothing there can run it, so the whole
        // question is whether the other replica ever sees it - which it can only do if the queue is
        // somewhere they share rather than in the process that took the request
        const jobId: string = await queueOn(first.baseUrl, 10);

        const settled: string = await running.waitFor(
            async () => await readJob(second.baseUrl, jobId),
            value => value.startsWith('COMPLETED:'),
            { timeoutInMs: 20000 }
        );

        // and it ran where the free worker was, not where the request landed
        expect(settled).toBe(`COMPLETED:${second.id}`);

        // both workers free again for the next case
        await running.waitFor(
            async () => await readJob(first.baseUrl, busyJobId),
            value => value.startsWith('COMPLETED:'),
            { timeoutInMs: 20000 }
        );
    }, 40000);

    it('tells a caller waiting on one replica that a job the other ran has ended, rather than leaving it to read the row', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        // queued where a worker is free, so it runs there
        const jobId: string = await queueOn(first.baseUrl, 1500);
        // and waited for where it does not run
        const res: Response = await fetch(`${second.baseUrl}/cluster-jobs/wait/${jobId}`);
        expect(res.status).toBe(200);
        const [status, ranOn, lagInMs] = (await res.text()).replaceAll('"', '').split(':');

        expect(status).toBe('COMPLETED');
        expect(ranOn).toBe(first.id);
        // the replica running it says when it ends, where reading the row again waits for the next read
        expect(Number(lagInMs)).toBeLessThan(1000);
    }, 40000);

    it('takes a job over when the replica running it stops existing', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        // long enough that the replica can be killed while it is still working on it
        const jobId: string = await queueOn(second.baseUrl, 6000);
        await running.waitFor(
            async () => await readJob(first.baseUrl, jobId),
            value => value.startsWith('IN_PROGRESS:'),
            { timeoutInMs: 20000 }
        );

        // SIGKILL, so nothing is written on the way out: this is the pod that was taken away rather
        // than asked to stop, and its row still says IN_PROGRESS with nothing to say it is a lie
        await running.kill(second.id, 'SIGKILL');

        // the claim is what says otherwise. It stops being renewed the moment the process is gone,
        // and once it lapses the job is takeable - without the job's own timeout, which is an hour,
        // having anything to do with it
        const settled: string = await running.waitFor(
            async () => await readJob(first.baseUrl, jobId),
            value => value.startsWith('COMPLETED:'),
            // a lapsed claim, then the poll of the surviving replica - which nobody tells about a
            // replica that is killed, so it finds the job within the 30s an idle poll waits at most -
            // and a full second run of the job
            { timeoutInMs: 55000 }
        );
        expect(settled).toBe(`COMPLETED:${first.id}`);
        // the work runs again from the beginning rather than resuming, which is the at-least-once
        // the docs promise
    }, 75000);

    // the harness rather than the queue, but only a thread job can show it: an instance's worker
    // threads never run its entry, so whatever decides which copy of the shared packages the instance
    // gets has to reach them some other way - or every job runs against whatever is built
    it('runs a job against the same copy of the shared packages as the instance it runs on', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);

        const modulePathRes: Response = await fetch(`${first.baseUrl}/cluster-jobs/module-path`);
        expect(modulePathRes.status).toBe(200);
        const instanceModulePath: string = (await modulePathRes.text()).replaceAll('"', '');

        const queueRes: Response = await fetch(`${first.baseUrl}/cluster-jobs/queue-module-path`, { method: 'POST' });
        expect(queueRes.status).toBe(200);
        const jobId: string = (await queueRes.text()).replaceAll('"', '');

        const settled: string = await running.waitFor(
            async () => await readJob(first.baseUrl, jobId),
            value => value.startsWith('COMPLETED:') || value.startsWith('FAILED:'),
            { timeoutInMs: 20000 }
        );
        expect(settled).toBe(`COMPLETED:${instanceModulePath}`);
    }, 40000);
});