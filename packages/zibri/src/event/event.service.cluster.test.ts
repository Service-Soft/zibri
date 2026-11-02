import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { eventLeaseInMs, slowHookWorkInMs } from './event.service.instance-options';
import { FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

/**
 * Docs/events.md promises that events survive restarts and are retried until every subscriber
 * registered at emit time has handled them.
 *
 * That is the sentence under test, across processes: it has to hold when the process that emitted
 * an event dies while handling it, which is what a rolling deploy does.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'event.service.instance-options.ts'),
        instances: 3
    });
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

describe('the event system across replicas', () => {

    // an event used to reach a subscriber once across the deployment, and nothing could run on
    // every replica. First, while every replica is up
    it('runs a subscriber on every instance once for an event emitted on one of them', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        await running.clearMarks();

        const res: Response = await fetch(`${running.instanceAt(0).baseUrl}/cluster-events/broadcast`, { method: 'POST' });
        expect(res.status).toBe(204);

        const heard: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('broadcast-heard'),
            rows => new Set(rows.map(r => r.instanceId)).size === running.instances.length
        );
        // and once each, the emitting instance included
        expect(heard.map(r => r.instanceId).sort()).toEqual(running.instances.map(i => i.id).sort());
    }, 30000);

    it('finishes an event whose emitting replica died while handling it', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const emitter: string = running.instanceAt(0).id;

        await running.clearMarks();

        const res: Response = await fetch(`${running.instanceAt(0).baseUrl}/cluster-events/emit`, { method: 'POST' });
        expect(res.status).toBe(204);

        // control: the event system works at all. If this fails the fixture is broken, not the
        // framework, and the assertion further down would be meaningless.
        const claimed: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('event-claimed'),
            rows => rows.length > 0
        );
        expect(claimed[0]?.instanceId).toBe(emitter);

        // guard: the kill has to land while the hook is still running, otherwise this test proves
        // nothing about an interrupted subscriber
        expect(await running.marks('event-done')).toEqual([]);

        // the pod handling the event dies - a rolling deploy, an OOM kill, a spot instance being
        // reclaimed. Two replicas are still up and the event is persisted as unfinished.
        await running.kill(emitter, 'SIGKILL');

        // so one of them has to finish it, or the event stays unfinished forever and the mail it
        // stood for is never sent.
        const done: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('event-done'),
            rows => rows.length > 0,
            // recovery cannot be faster than the claim it waits out: the dead instance's claim runs
            // for 5s. Nobody was told about the event, since every replica hosts the subscriber, so
            // the dispatch poll finds it within the 30s an idle poll waits at most plus one 5s tick,
            // and the hook itself takes 2s. Some margin, so a slow container does not read as a
            // broken framework.
            { timeoutInMs: 55000 }
        );

        expect(done.map(m => m.instanceId)).not.toContain(emitter);
        // and exactly once: one logical subscriber, however many replicas host it
        expect(done).toHaveLength(1);
        // above the usual 15000 on purpose: the wait above is bounded by a real claim expiring and
        // a real poll interval, not by anything this test controls
    }, 75000);

    it('runs a subscriber once even when the hook outlives the claim on the event', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;

        // every surviving replica, because any of them can pick the claim up once it looks abandoned
        await Promise.all(running.instances.map(async instance => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-events/slow-hooks`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        await running.clearMarks();

        const res: Response = await fetch(`${running.instanceAt(0).baseUrl}/cluster-events/emit`, { method: 'POST' });
        expect(res.status).toBe(204);

        await running.waitFor(
            async () => await running.marks('event-done'),
            rows => rows.length > 0,
            { timeoutInMs: slowHookWorkInMs * 2 }
        );

        // a second claim can only be taken while the first hook is still running, so by the time
        // that hook reports itself done every takeover there was going to be has already been
        // recorded. One dispatch interval of margin covers a poll landing right on that boundary.
        await new Promise<void>(resolve => {
            setTimeout(resolve, eventLeaseInMs + Ms.SECOND);
        });

        // asserted first, because it is the more basic property: a replica that lost its claim mid
        // hook used to go on writing the result against a row the new claimant had already deleted,
        // and the failure reached no handler, so node ended the replica over it. Losing a claim is a
        // normal outcome in a cluster and must never cost an instance.
        for (const instance of running.instances) {
            const alive: Response = await fetch(`${instance.baseUrl}/explorer`);
            expect({ instance: instance.id, ok: alive.ok }).toEqual({ instance: instance.id, ok: true });
        }

        // asserted on the claims rather than only on the completions: a replica that took the event
        // over is still working at this point, so the duplicate is visible here a whole hook earlier
        // than it would be in the marks the subscriber writes when it finishes
        expect(await running.marks('event-claimed')).toHaveLength(1);

        // a claim that is not renewed while the hook works is collected as abandoned once the hook
        // outlives the lease, and the subscriber runs a second time on another replica - the
        // duplicate welcome mail this whole ledger exists to prevent.
        expect(await running.marks('event-done')).toHaveLength(1);
        // well above 15000 on purpose: the hook is deliberately slower than the lease, and the test
        // then has to outlast the window in which a takeover could still happen
    }, 60000);
});