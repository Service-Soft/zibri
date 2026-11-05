import { describe, expect, it } from '@jest/globals';

import { createTestDataSource } from './create-test-data-source.function';
import { StartedTestServer, startTestServer } from './start-test-server.function';
import { Pg, PgSessionClient } from '../../data-source/data-sources/postgres/postgres-client.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { TestTimeouts } from '../constants';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

// a pool that outlived its application kept its connections until the harness stopped the container,
// and the server ending them reached the pool's error listener after the application was gone: its
// logger threw NoProviderError, which jest charged to a test of the next file the worker ran
describe('a test server, shut down while a connection to its database is still open', () => {
    it('refuses the shutdown, naming the connection', async () => {
        const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        const options: PostgresOptions = inject(dataSourceClass).options;
        const pg: Pg = optionalPeer<Pg>('pg', 'Connecting past the application');
        const leaked: PgSessionClient = new pg.Client({
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password?.toString(),
            database: options.database
        });
        // the container stopping under it ends it, and an error event nobody listens for is thrown
        leaked.on('error', () => undefined);
        await leaked.connect();
        await leaked.query('SELECT \'left open\'');

        await expect(server.shutdown()).rejects
            .toThrow(/^1 connection\(s\) of \w+ outlived the application:\n {2}- pid \d+, idle, last ran: SELECT 'left open'$/);
    }, TestTimeouts.postgres.start + TestTimeouts.postgres.shutdown);
});