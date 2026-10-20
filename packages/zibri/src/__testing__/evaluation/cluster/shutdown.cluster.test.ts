import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClusterInstance, ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { blockedSectionKey, httpDrainTimeoutInMs, leaseDrainTimeoutInMs, lockHoldInMs, sectionKey } from './shutdown.instance-options.ts';
import { FsUtilities } from '../../../utilities/fs.utilities.ts';

/**
 * Covers the shutdown half of evaluation/10-leases-and-claims.md.
 *
 * A replica that is asked to stop is still holding whatever grants its work took. Keeping them until
 * they expire makes every other replica wait out a full lease for work that stopped seconds ago,
 * which on a rolling deploy is a stall per grant for no reason. Handing them back the moment the
 * signal arrives is worse: the work is still running, so a second replica would start the same work.
 *
 * LeaseService waits for the work first and only takes the grant away when that wait runs out. This
 * is the only test that observes it, because the path needs a real signal, real in flight work and a
 * second process to take over.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'shutdown.instance-options.ts'),
        instances: 2
    });
}, 15000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * Reads the marks written on entering and leaving one contended section, oldest first.
 *
 * Filtered by which lock they belong to: the replica that takes over in the first scenario is still
 * inside its section while the second one runs, so the two would otherwise read each other's marks.
 * @param startedCluster - The cluster to read from.
 * @param key - The lock whose marks are wanted.
 * @returns Every mark for that section.
 */
async function sectionMarks(startedCluster: StartedTestCluster, key: string): Promise<ClusterMarkRow[]> {
    const marks: ClusterMarkRow[] = await startedCluster.marks();
    return marks.filter(m => m.tag === key && (m.kind === 'section-enter' || m.kind === 'section-exit'));
}

describe('evaluation/10-leases-and-claims - handing grants back on shutdown', () => {

    it('lets another replica take over work a shutting down instance was holding', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        await running.clearMarks();

        const holder: ClusterInstance = running.instanceAt(0);
        const successor: ClusterInstance = running.instanceAt(1);

        // the first replica takes the section and settles into it
        const startedHolding: Response = await fetch(`${holder.baseUrl}/cluster-shutdown/enter`, { method: 'POST' });
        expect(startedHolding.status).toBe(204);

        await running.waitFor(
            async () => await sectionMarks(running, sectionKey),
            marks => marks.some(m => m.instanceId === holder.id && m.kind === 'section-enter')
        );

        // the second asks for it and waits, because the first is still in there
        const startedWaiting: Response = await fetch(`${successor.baseUrl}/cluster-shutdown/enter`, { method: 'POST' });
        expect(startedWaiting.status).toBe(204);

        // guard: it really is waiting rather than already inside. Without this the assertion below
        // could pass on a lock that never worked in the first place.
        await new Promise<void>(resolve => {
            setTimeout(resolve, leaseDrainTimeoutInMs);
        });
        const beforeShutdown: ClusterMarkRow[] = await sectionMarks(running, sectionKey);
        expect(beforeShutdown.map(m => `${m.instanceId} ${m.kind}`)).toEqual([`${holder.id} section-enter`]);

        // a rolling deploy takes the holder away while it is still working. SIGTERM rather than
        // SIGKILL: this is the graceful path, the one where the framework gets to hand things back.
        const shutdownAt: number = Date.now();
        await running.kill(holder.id, 'SIGTERM');

        // the successor gets in, and the only way it can is the holder having released on the way
        // out - the lock itself lives for a minute and was renewed until the moment of the signal.
        await running.waitFor(
            async () => await sectionMarks(running, sectionKey),
            marks => marks.some(m => m.instanceId === successor.id && m.kind === 'section-enter'),
            { timeoutInMs: 20000 }
        );

        const tookOverAfterMs: number = Date.now() - shutdownAt;
        expect({ tookOverWithinTheHold: tookOverAfterMs < lockHoldInMs }).toEqual({ tookOverWithinTheHold: true });

        // and in the right order, so the takeover is a handover rather than the two overlapping
        const marks: ClusterMarkRow[] = await sectionMarks(running, sectionKey);
        expect(marks.map(m => `${m.instanceId} ${m.kind}`)).toEqual([
            `${holder.id} section-enter`,
            `${successor.id} section-enter`
        ]);
        // above the usual 15000 on purpose: the work is deliberately longer than the drain waits for,
        // so the handover cannot happen before that wait has run out
    }, 60000);

    it('hands the grant back even while a request refuses to end', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        // back to two: the previous test took one away, and this needs somebody to hand over to
        await running.scaleTo(2);

        const holder: ClusterInstance = running.instanceAt(0);
        const successor: ClusterInstance = running.instanceAt(1);

        const startedHolding: Response = await fetch(
            `${holder.baseUrl}/cluster-shutdown/enter-blocked`,
            { method: 'POST' }
        );
        expect(startedHolding.status).toBe(204);

        await running.waitFor(
            async () => await sectionMarks(running, blockedSectionKey),
            marks => marks.some(m => m.instanceId === holder.id && m.kind === 'section-enter')
        );

        // and now a request that will not finish - a long poll, a slow download, a stuck upstream.
        // Never awaited: the point is that it is still open when the signal arrives. Closing the
        // http server waits for every open connection and runs before any shutdown hook, so this
        // used to be enough on its own to stop the leases from ever being handed back.
        void fetch(`${holder.baseUrl}/cluster-shutdown/slow-request`, { method: 'POST' })
            // the connection is cut when the replica goes away, which is exactly what should happen
            // to it - the request never gets an answer and does not need one
            // eslint-disable-next-line promise/prefer-await-to-then
            .catch(() => undefined);

        const startedWaiting: Response = await fetch(
            `${successor.baseUrl}/cluster-shutdown/enter-blocked`,
            { method: 'POST' }
        );
        expect(startedWaiting.status).toBe(204);

        // guard: the successor is waiting, and the slow request is genuinely still open
        await new Promise<void>(resolve => {
            setTimeout(resolve, httpDrainTimeoutInMs);
        });
        const beforeShutdown: ClusterMarkRow[] = await sectionMarks(running, blockedSectionKey);
        expect(beforeShutdown.map(m => `${m.instanceId} ${m.kind}`)).toEqual([`${holder.id} section-enter`]);

        await running.kill(holder.id, 'SIGTERM');

        // the drain has to have given up on the request and moved on, or the lock would still be
        // held - and it would stay held until it expires a minute later, long past this wait
        await running.waitFor(
            async () => await sectionMarks(running, blockedSectionKey),
            marks => marks.some(m => m.instanceId === successor.id && m.kind === 'section-enter'),
            { timeoutInMs: 20000 }
        );
        // same reasoning as above on the timeout
    }, 60000);
});