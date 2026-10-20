import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { eventLeaseInMs, slowHookWorkInMs } from './events.instance-options.ts';
import { FsUtilities } from '../../../utilities/fs.utilities.ts';
import { Ms } from '../../../utilities/ms.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md sections 1.4 and 1.5.
 *
 * Docs/events.md opens with "every emitted event and every subscriber's processing attempt is
 * persisted, so events survive restarts and are retried until every subscriber that was registered
 * at emit time has successfully processed them".
 *
 * That is the sentence under test. Delivery is an in-process rxjs Subject and the persisted row is
 * a log nothing polls, so the promise holds only as long as the process that emitted the event
 * stays alive - which is exactly the assumption a rolling deploy breaks.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'events.instance-options.ts'),
        instances: 3
    });
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

describe('evaluation/04-infrastructure-subsystems - the event system across replicas', () => {

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

        // so one of them has to finish it. Today nothing polls the table, so the event stays
        // unfinished forever and the mail it stood for is simply never sent.
        const done: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('event-done'),
            rows => rows.length > 0,
            // recovery cannot be faster than the claim it waits out: the dead instance's claim runs
            // for 5s, the dispatch poll then finds it within another 5s, and the hook itself takes
            // 2s. Roughly twice that, so a slow container does not read as a broken framework.
            { timeoutInMs: 25000 }
        );

        expect(done.map(m => m.instanceId)).not.toContain(emitter);
        // and exactly once: one logical subscriber, however many replicas host it
        expect(done).toHaveLength(1);
        // above the usual 15000 on purpose: the wait above is bounded by a real claim expiring and
        // a real poll interval, not by anything this test controls
    }, 40000);

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

        // asserted first, because it is the more basic property and because the assertions below
        // are still expected to fail: a replica that loses its claim mid hook goes on to write the
        // result anyway, against a row the new claimant already deleted. That used to reach nobody
        // - the write sat outside runHook's try/catch, the promise was discarded with `void`, and
        // there was no process level handler - so node ended the replica over it. Losing a claim is
        // a normal outcome in a cluster and must never cost an instance.
        for (const instance of running.instances) {
            const alive: Response = await fetch(`${instance.baseUrl}/explorer`);
            expect({ instance: instance.id, ok: alive.ok }).toEqual({ instance: instance.id, ok: true });
        }

        // asserted on the claims rather than only on the completions: a replica that took the event
        // over is still working at this point, so the duplicate is visible here a whole hook earlier
        // than it would be in the marks the subscriber writes when it finishes
        expect(await running.marks('event-claimed')).toHaveLength(1);

        // the claim is taken once and never renewed, and finishing never checks it is still ours.
        // A hook slower than the lease is collected as abandoned while it is still working, so the
        // subscriber runs a second time on another replica - the duplicate welcome mail this whole
        // ledger exists to prevent.
        expect(await running.marks('event-done')).toHaveLength(1);
        // well above 15000 on purpose: the hook is deliberately slower than the lease, and the test
        // then has to outlast the window in which a takeover could still happen
    }, 60000);
});