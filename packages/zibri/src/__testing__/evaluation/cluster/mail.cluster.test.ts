import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { mailCronIntervalInMs, queuedMailCount } from './mail.instance-options.ts';
import { FsUtilities } from '../../../utilities/fs.utilities.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.6.
 *
 * EmailService.onAppInit registers SendQueuedEmailsCronJob on whatever application is booting, so
 * every replica runs it. The job reads the QUEUED rows and only writes back once the send has
 * returned, which leaves every other replica free to read the same rows in the meantime. The user
 * gets the mail once per replica and nothing anywhere reports a duplicate.
 *
 * Two halves, because a per execution lease only closes the first one: replicas racing over the same
 * tick, and a send still running when the next tick starts somewhere else.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ../README.md for why.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'mail.instance-options.ts'),
        instances: 3
    });
}, 20000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * Groups the marks by the mail they were written for.
 * @param marks - The marks to group.
 * @returns The instances that sent each mail, keyed by mail id.
 */
function sendersByMail(marks: ClusterMarkRow[]): Map<string, string[]> {
    const res: Map<string, string[]> = new Map();
    for (const mark of marks) {
        res.set(mark.tag, [...res.get(mark.tag) ?? [], mark.instanceId]);
    }
    return res;
}

/**
 * Waits until every queued mail has left the table.
 *
 * The mails are queued with persist false, so a sent mail is a deleted row. Once they are all gone
 * no further replica can pick them up, which makes this the earliest moment the marks can be
 * counted without racing whatever is still in flight.
 * @param startedCluster - The cluster to read from.
 */
async function waitForDrainedQueue(startedCluster: StartedTestCluster): Promise<void> {
    await startedCluster.waitFor(
        async () => await startedCluster.sql<{ count: string }>('select count(*)::text as count from email'),
        rows => rows[0]?.count === '0',
        { timeoutInMs: 40000 }
    );
}

describe('evaluation/04-infrastructure-subsystems 1.6 - queued mail across replicas', () => {

    it('sends each queued mail exactly once no matter how many replicas are draining the queue', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        // one instance fills the queue. Which one is irrelevant - the rows are shared, and every
        // replica's cron job is looking at them.
        const res: Response = await fetch(`${cluster.instanceAt(0).baseUrl}/cluster-mail/queue`, { method: 'POST' });
        expect(res.status).toBe(204);

        // waits for the count to stop being short rather than for a fixed duration, then keeps
        // reading below: a duplicate arrives *after* the correct count is reached, so stopping here
        // would be exactly the wrong moment to assert.
        const marks: ClusterMarkRow[] = await cluster.waitFor(
            async () => await cluster?.marks('mail-sent') ?? [],
            m => m.length >= queuedMailCount
        );

        const byMail: Map<string, string[]> = sendersByMail(marks);

        // every queued mail was picked up
        expect(byMail.size).toBe(queuedMailCount);

        // and each one by a single replica. Before the fix this is one row per mail per replica.
        for (const [mailId, sentBy] of byMail) {
            expect({ mailId, sentBy }).toEqual({ mailId, sentBy: [expect.any(String)] });
        }
    }, 30000);

    it('leaves the queue empty', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        // the mails were queued with persist false, so a sent mail is a deleted row. A leftover here
        // means a replica claimed work it never finished.
        await waitForDrainedQueue(cluster);

        const remaining: { count: string }[] = await cluster.sql('select count(*)::text as count from email');
        expect(remaining[0]?.count).toBe('0');
    }, 30000);

    it('sends each mail exactly once even when a send outlives the interval between two ticks', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        // every replica, because any of them can win the next slot
        await Promise.all(cluster.instances.map(async instance => {
            const res: Response = await fetch(`${instance.baseUrl}/cluster-mail/slow-sends`, { method: 'POST' });
            expect(res.status).toBe(204);
        }));

        await cluster.clearMarks();

        const res: Response = await fetch(`${cluster.instanceAt(0).baseUrl}/cluster-mail/queue`, { method: 'POST' });
        expect(res.status).toBe(204);

        await waitForDrainedQueue(cluster);

        // one further tick after the rows are gone: a replica that read them just before they were
        // deleted has already written its marks, but a replica that started a slot slightly later
        // has not, and asserting between the two would report a clean run that is not one
        await new Promise<void>(resolve => {
            setTimeout(resolve, mailCronIntervalInMs);
        });

        const byMail: Map<string, string[]> = sendersByMail(await cluster.marks('mail-sent'));

        expect(byMail.size).toBe(queuedMailCount);

        // the lease covers one scheduled execution, so it keeps two replicas out of the *same* slot.
        // It does not stop the next slot from starting while this one is still sending, and the rows
        // it re-reads are still QUEUED because the status is only written back after send returns.
        for (const [mailId, sentBy] of byMail) {
            expect({ mailId, sentBy }).toEqual({ mailId, sentBy: [expect.any(String)] });
        }
        // longer than the usual 15000 on purpose: the send is deliberately slower than the tick, so
        // draining the queue cannot be quicker than that
    }, 60000);
});