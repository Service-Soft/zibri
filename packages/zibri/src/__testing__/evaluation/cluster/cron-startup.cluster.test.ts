import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterMarkRow, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { executionLeaseInMs } from './cron-startup.instance-options';
import { FsUtilities } from '../../../utilities/fs.utilities';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 1.3, across instances.
 *
 * A job that asks for a startup run gets one per deploy, not one per instance that boots. The
 * instances agree on it without talking by keying the claim on the slot that is coming, which is
 * the same for every instance of one rolling deploy - cron.test.ts can only show two jobs asking
 * within the same millisecond, and a deploy spreads the asking over minutes.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'cron-startup.instance-options.ts'),
        instances: 1
    });
}, 20000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

describe('evaluation/04-infrastructure-subsystems - a startup run across a rolling deploy', () => {

    it('performs a startup run on one instance, however long after it the others boot', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        // longer than a claim on a scheduled execution lives, which is what a slow rolling deploy
        // looks like with the default: the claim used to be held for that long rather than until
        // the slot it names, so every instance booting after it ran out won the same key again
        await new Promise<void>(resolve => {
            setTimeout(resolve, executionLeaseInMs * 3);
        });
        await cluster.scaleTo(3);

        const marks: ClusterMarkRow[] = await cluster.marks('cron-startup');

        // the ids rather than the rows, so a failure says which instances ran it
        expect(marks.map(m => m.instanceId)).toEqual(['instance-0']);
    }, 45000);
});