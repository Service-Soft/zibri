import { describe, expect, it } from '@jest/globals';
import { StartedTestCluster, startTestCluster } from 'zibri-testing';

import { stuckStatementMarker } from './test-cluster-boot.instance-options';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What a test cluster reports about an instance that does not finish booting.
 *
 * An instance waiting on another one, for a lock or for a statement, logs nothing while it waits, so
 * its own output ended where the wait began and said nothing about what it was.
 */
describe('a test cluster whose instance does not finish booting', () => {
    it('reports what the sessions of its data sources were doing as it gave up', async () => {
        const started: Promise<StartedTestCluster> = startTestCluster({
            instanceOptions: FsUtilities.getPath(__dirname, 'test-cluster-boot.instance-options.ts'),
            instances: 1
        });

        await expect(started).rejects.toThrow(new RegExp(`did not become ready[\\S\\s]*What the sessions[\\S\\s]*${stuckStatementMarker}`));
    }, 60000);
});