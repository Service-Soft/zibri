import { afterAll, beforeAll } from 'vitest';

import { describeMistypedColumnValues, describeMistypedValues, Gauge, MistypedValueFixture } from './mistyped-values.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

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
            // cspell:disable-next-line
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