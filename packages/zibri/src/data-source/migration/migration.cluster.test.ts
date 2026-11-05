import { afterAll, describe, expect, it } from '@jest/globals';
import { StartedTestCluster, startTestCluster } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { FsUtilities } from '../../utilities/fs.utilities';

/**
 * Three instances starting together, which is what a rolling deploy, a scale-out and a fresh
 * environment all look like. Without a lock around the schema setup they all read an empty
 * migration table, all decide the migration still needs running, and all run it.
 *
 * MigrationEntity has `name` and `version` as unique, so the losing instances do not merely
 * duplicate work: their insert is rejected, runUp rolls back and rethrows, and the instance fails
 * to start. A deploy where two of three pods crash-loop.
 *
 * Booted with bootMode: 'simultaneous' - the reason it exists. The other cluster tests boot
 * sequentially so the schema settles first.
 */

let cluster: StartedTestCluster | undefined;

afterAll(async () => {
    // guarded so a failed start reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, TestTimeouts.resolveCluster(3, 'postgres').shutdown);

describe('migrations across replicas', () => {

    it('starts every instance when they run migrations at the same time', async () => {
        cluster = await startTestCluster({
            instanceOptions: FsUtilities.getPath(__dirname, 'migration.instance-options.ts'),
            instances: 3,
            bootMode: 'simultaneous'
        });

        // the assertion is that the line above did not throw. startTestCluster rejects with the
        // instance's own boot error, so a failure here reads as the unique violation it really is.
        expect(cluster.instances).toHaveLength(3);
    }, TestTimeouts.resolveCluster(3, 'postgres').start);

    it('applies the migration exactly once', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        const applied: { version: string, count: number }[] = await cluster.sql(
            'select "version", count(*)::int as "count" from migration_entity group by "version"'
        );

        // one row per migration, not one per instance that happened to run it. A duplicated ledger
        // is how a migration gets re-applied - or skipped - on the next deploy.
        expect(applied).toEqual([{ version: '1.0.0', count: 1 }]);
    }, 15000);
});