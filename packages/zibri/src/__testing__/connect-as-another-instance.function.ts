import { Pg, PgSessionClient } from '../data-source/data-sources/postgres/postgres-client.model';
import { PostgresDataSource, PostgresOptions } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { optionalPeer } from '../utilities/optional-peer.function';

/**
 * Opens a connection of its own to the database of a postgres data source, as another instance has, which outlives
 * the application of the test, such as across a restart.
 * @param dataSource - The data source.
 * @returns The connection, open, which the test ends.
 */
export async function connectAsAnotherInstance(dataSource: PostgresDataSource): Promise<PgSessionClient> {
    const options: PostgresOptions = dataSource.options;
    const pg: Pg = optionalPeer<Pg>('pg', 'Connecting as another instance');
    const client: PgSessionClient = new pg.Client({
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password?.toString(),
        database: options.database
    });
    await client.connect();
    return client;
}