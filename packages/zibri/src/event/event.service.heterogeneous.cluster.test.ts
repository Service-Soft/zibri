import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { webInstanceId } from './event.service.heterogeneous.instance-options';
import { TestTimeouts } from '../__testing__/constants';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * An event emitted on one replica reaches the subscribers registered on the others.
 *
 * This needs a cluster whose replicas are *not* interchangeable, which is what separates it from
 * every other cluster test. In an identical deployment - every replica running the same image,
 * which is the normal case - the emitting instance's own subscribers are the cluster's, and an
 * emit that only knew its own process would still look right. Split the roles, as any deployment
 * with a worker tier does, and it shows: the emitter took the event for handled once its own
 * subscriber finished, and the others never ran.
 */

/**
 * Long enough to cover several runs of the five second dispatch poll, so a red here means the event
 * was closed out rather than that the poll had not come round yet.
 */
const deliveryTimeoutInMs: number = 20000;

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'event.service.heterogeneous.instance-options.ts'),
        instances: 3
    });
}, TestTimeouts.resolveCluster(3, 'postgres').start);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, TestTimeouts.resolveCluster(3, 'postgres').shutdown);

describe('events across differing replicas', () => {

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

        // and the one that only exists on the workers has to run too. An emitter that only knew its
        // own auditor would mark the event finished once that auditor did - the confirmation mail
        // never sent, and nothing anywhere reporting a failure.
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

        // the same from the other direction, and worth its own test: subscribers known only on the
        // emit path of one role would leave this one red
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