import { afterAll, beforeAll } from '@jest/globals';

import { describeMistypedColumnValues, describeMistypedValues, Gauge, MistypedValueFixture } from './mistyped-values.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Gauge],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Gauge]
});

let server: StartedTestServer | undefined;
let postgres: MistypedValueFixture;
let valKey: MistypedValueFixture;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    postgres = {
        repository: postgresDataSource.getRepository(Gauge),
        overwrite: async (id, column, json) => {
            // a json column is the only one postgres takes a value of another type in, which is why
            // only the cases about a value inside an object run here
            await queryPostgres(
                postgresDataSource,
                `UPDATE gauge SET "${column}" = $1::jsonb WHERE id = $2`,
                [json, id]
            );
        }
    };
    valKey = {
        repository: valKeyDataSource.getRepository(Gauge),
        overwrite: async (id, column, json) => {
            // eslint-disable-next-line cspell/spellchecker
            await valKeyDataSource.connection.hset(`${valKeyDataSource.keyPrefix}:gauge:${id}`, { [column]: json });
        }
    };
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeMistypedValues('postgres', () => postgres);

describeMistypedValues('valkey', () => valKey);

describeMistypedColumnValues('valkey', () => valKey);