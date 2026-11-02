import { afterAll, describe, expect, it } from '@jest/globals';
import { StartedTestCluster, startTestCluster } from 'zibri-testing';

import { FsUtilities } from '../../../utilities/fs.utilities';
import { Ms } from '../../../utilities/ms';

/**
 * The lock around the schema setup, behind a pooler in transaction mode.
 *
 * The lock is an advisory lock of the session that took it. Behind a pooler in transaction mode the
 * lock and the unlock are not guaranteed the same server connection, and a second instance's lock
 * request handed the connection that already holds it is granted - so instances booting together set
 * the schema up at the same time, and all but one fail on the migration ledger's unique key.
 */

/**
 * How long the cluster takes to start: the pooler installs PgBouncer as its container starts, and
 * three instances boot behind it.
 */
const CLUSTER_START_IN_MS: number = 120 * Ms.SECOND;

let cluster: StartedTestCluster | undefined;

afterAll(async () => {
    await cluster?.shutdown();
}, 30 * Ms.SECOND);

describe('instances behind a transaction pooler setting up the schema at once', () => {

    it('starts every instance', async () => {
        cluster = await startTestCluster({
            instanceOptions: FsUtilities.getPath(__dirname, 'postgres-transaction-pooler.instance-options.ts'),
            instances: 3,
            bootMode: 'simultaneous'
        });

        expect(cluster.instances).toHaveLength(3);
    }, CLUSTER_START_IN_MS);

    it('applies the migration exactly once', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }

        const applied: { version: string, count: number }[] = await cluster.sql(
            'select "version", count(*)::int as "count" from migration_entity group by "version"'
        );

        expect(applied).toEqual([{ version: '1.0.0', count: 1 }]);
    }, 15 * Ms.SECOND);
});