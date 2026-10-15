import { afterAll, beforeAll } from '@jest/globals';

import { describeMistypedColumnValues, describeMistypedValues, Gauge, MistypedValueFixture } from './mistyped-values.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Gauge]
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
            await postgresDataSource.query(Gauge).connection.query(
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
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeMistypedValues('postgres', () => postgres);

describeMistypedValues('valkey', () => valKey);

describeMistypedColumnValues('valkey', () => valKey);