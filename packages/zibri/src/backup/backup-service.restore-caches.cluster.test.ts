import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { FsUtilities } from '../utilities/fs.utilities';
import { restoreCachesBackupFolder } from './backup-service.restore-caches.instance-options';

/**
 * A restore of the application replaces the rows past every write that would invalidate a tag, while the
 * other instances keep running with what they cached of the rows it replaced. Their caches are local, so
 * only being told empties them: within the few seconds an instance takes to apply an invalidation, never
 * only once their entries expire.
 */

let cluster: StartedTestCluster | undefined;

beforeAll(async () => {
    await FsUtilities.rm(restoreCachesBackupFolder);
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'backup-service.restore-caches.instance-options.ts'),
        instances: 2
    });
}, TestTimeouts.resolveCluster(2, 'postgres').start);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
    await FsUtilities.rm(restoreCachesBackupFolder);
}, TestTimeouts.resolveCluster(2, 'postgres').shutdown);

/**
 * Reads the value the given instance currently believes.
 * @param baseUrl - The instance to ask.
 * @returns What it answered.
 */
async function readValue(baseUrl: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/restore-caches/value`);
    expect(res.status).toBe(200);
    return Number(await res.text());
}

async function post(baseUrl: string, path: string): Promise<void> {
    const res: Response = await fetch(`${baseUrl}/restore-caches${path}`, { method: 'POST' });
    expect(res.status).toBe(204);
}

describe('BackupService - the caches of other instances across a restore of the application', () => {
    it('empties the caches of another instance once the application is restored on one', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const running: StartedTestCluster = cluster;
        const first: ClusterInstance = running.instanceAt(0);
        const second: ClusterInstance = running.instanceAt(1);

        await post(first.baseUrl, '/backup');
        await post(first.baseUrl, '/bump');
        // both instances cache what was written since the backup
        expect(await readValue(first.baseUrl)).toBe(1);
        expect(await readValue(second.baseUrl)).toBe(1);

        await post(first.baseUrl, '/restore');

        // control: the instance restoring empties its own caches at once. If this fails the fixture is
        // broken rather than what is told to the other instance, and the assertion below means nothing
        expect(await readValue(first.baseUrl)).toBe(0);
        // waited for rather than read once: the other instance is told through the data source
        const settled: number = await running.waitFor(
            async () => await readValue(second.baseUrl),
            value => value === 0,
            { timeoutInMs: 10000 }
        );
        expect(settled).toBe(0);
    }, 60000);
});