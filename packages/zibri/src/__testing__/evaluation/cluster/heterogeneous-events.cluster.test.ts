import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { webInstanceId } from './heterogeneous-events.instance-options';
import { FsUtilities } from '../../../utilities/fs.utilities';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md 1.4b - emit only knows about
 * subscribers in its own process.
 *
 * This needs a cluster whose replicas are *not* interchangeable, which is what separates it from
 * every other event test here. In an identical deployment - every replica running the same image,
 * which is the normal case - the emitting instance's local subscriber set equals the cluster wide
 * one and the bug is invisible. Split the roles, which is what any deployment with a worker tier
 * does, and it appears.
 *
 * The mechanism, for whoever fixes it: emit snapshots subscriberIds from the emitting process
 * (event.service.ts:101), and eventHasUnfinishedSubscriptions then reconciles that snapshot against
 * the emitter's own local subscriptions (`:419`). Both halves are local, so the emitter concludes
 * the event is fully handled the moment its own subscriber finishes, and marks it FINISHED. The
 * dispatch poll on the other replicas only ever looks for events that are *not* finished.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ../README.md for why.
 */

/**
 * Long enough to cover several runs of the five second dispatch poll, so a red here means the event
 * was closed out rather than that the poll had not come round yet.
 */
const deliveryTimeoutInMs: number = 20000;

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'heterogeneous-events.instance-options.ts'),
        instances: 3
    });
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

describe('evaluation/04-infrastructure-subsystems 1.4b - events across differing replicas', () => {

    it('runs the worker subscriber for an event the web replica emitted', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;

        await running.clearMarks();

        const res: Response = await fetch(`${running.instance(webInstanceId).baseUrl}/cluster-heterogeneous/emit`, { method: 'POST' });
        expect(res.status).toBe(204);

        // control: the emitter's own subscriber runs. It proves the event was emitted, that
        // subscribing works and that a mark can be written, so the assertion below is about the
        // subscriber that lives elsewhere rather than about the fixture.
        const audited: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('order-audited'),
            rows => rows.length > 0
        );
        expect(audited).toHaveLength(1);
        expect(audited[0]?.instanceId).toBe(webInstanceId);

        // and the one that only exists on the workers has to run too. Today the web replica records
        // subscriberIds containing only its own auditor, so once that auditor finishes the event is
        // marked FINISHED - the confirmation mail is never sent, and nothing anywhere reports a
        // failure, because as far as the emitting process could tell the event was fully handled.
        const mailed: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('order-mailed'),
            rows => rows.length > 0,
            { timeoutInMs: deliveryTimeoutInMs }
        );

        // exactly once, however many workers host the subscriber
        expect(mailed).toHaveLength(1);
        expect(mailed[0]?.instanceId).not.toBe(webInstanceId);
    }, 45000);

    it('runs the web subscriber for an event a worker replica emitted', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const worker: string = running.instances.map(i => i.id).find(id => id !== webInstanceId) ?? '';

        await running.clearMarks();

        const res: Response = await fetch(`${running.instance(worker).baseUrl}/cluster-heterogeneous/emit`, { method: 'POST' });
        expect(res.status).toBe(204);

        // the same defect from the other direction, and worth its own test: a fix that reconciled
        // subscribers only on the emit path of one role would leave this one red
        const mailed: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('order-mailed'),
            rows => rows.length > 0
        );
        expect(mailed).toHaveLength(1);

        const audited: ClusterMarkRow[] = await running.waitFor(
            async () => await running.marks('order-audited'),
            rows => rows.length > 0,
            { timeoutInMs: deliveryTimeoutInMs }
        );

        expect(audited).toHaveLength(1);
        expect(audited[0]?.instanceId).toBe(webInstanceId);
    }, 45000);
});