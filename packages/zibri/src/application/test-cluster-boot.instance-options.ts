import { clusterInstanceBootTimeoutInMs, createPostgresTestDataSource, defaultClusterProviders, defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { queryPostgres } from '../__testing__/query-postgres.function';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { Newable } from '../types/newable.type';

/**
 * What every instance of a cluster whose boot never finishes boots with.
 *
 * Like every instance options module, this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * The name the statement the boot waits on answers with, which the parent looks for.
 */
export const stuckStatementMarker: string = 'stuck_on_purpose';

/**
 * The data source every instance boots on. A module level constant, so the parent and the instances
 * agree on it.
 */
const stuckDataSource: Newable<PostgresDataSource> = createPostgresTestDataSource({ entities: defaultClusterTestEntities });

/**
 * Keeps the boot waiting on a statement for longer than the harness waits for it, as a boot waiting
 * on another instance does.
 */
class StuckBoot implements OnAppInit {
    /**
     * Runs statements until the harness gave up.
     */
    async onAppInit(): Promise<void> {
        // the harness's wait began before this instance even loaded, so a whole one from here outlasts
        // it. One statement at a time, each well inside the statement timeout, so it is the harness that
        // gives up first however long it waits
        const until: number = Date.now() + clusterInstanceBootTimeoutInMs;
        while (Date.now() < until) {
            await queryPostgres(inject(stuckDataSource), `SELECT pg_sleep(10) AS "${stuckStatementMarker}"`);
        }
    }
}

const options: StartTestServerOptions = {
    dataSources: [stuckDataSource],
    providers: [...defaultClusterProviders, defineProvider({ token: StuckBoot, useClass: StuckBoot })]
};

export default options;