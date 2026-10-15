import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { FsUtilities } from '../../../utilities/fs.utilities';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md sections 2.7, 2.10 and 2.12.
 *
 * The queue is a table, so both halves of that are claims about a cluster and neither can be
 * observed in one process: that a job queued on a busy instance is run by a free one, and that a job
 * whose instance stopped existing is taken over rather than left.
 *
 * Every instance here has exactly one worker for normal jobs. That is what makes the first half
 * decisive - a replica that is already busy cannot be the one that runs the next job, so if the job
 * runs at all, another replica ran it - and the fixture reports the id of the instance it ran on,
 * read from that process's own environment.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'thread-jobs.instance-options.ts'),
        instances: 2
    });
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

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

describe('evaluation/04-infrastructure-subsystems 2.7 / 2.10 - the queue across replicas', () => {

    it('runs a job on another replica when the one it was queued on is busy', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        // takes the first instance's only worker for the rest of this test
        await queueOn(first.baseUrl, 4000);

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
            { timeoutInMs: 40000 }
        );
        expect(settled).toBe(`COMPLETED:${first.id}`);
        // the work runs again from the beginning rather than resuming, which is the at-least-once
        // the docs promise - the wait above is a lapsed claim plus a full second run of the job
    }, 60000);

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