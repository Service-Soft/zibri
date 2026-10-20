import { afterAll, beforeAll } from 'vitest';

import { describeUuidValues, UuidItem, UuidOwner, UuidValueRepositories } from './uuid-values.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, UuidOwner, UuidItem]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, UuidOwner, UuidItem]
});

let server: StartedTestServer | undefined;
let postgres: UuidValueRepositories;
let valKey: UuidValueRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    postgres = {
        owners: postgresDataSource.getRepository(UuidOwner),
        items: postgresDataSource.getRepository(UuidItem)
    };
    valKey = {
        owners: valKeyDataSource.getRepository(UuidOwner),
        items: valKeyDataSource.getRepository(UuidItem)
    };
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeUuidValues('postgres', () => postgres);

describeUuidValues('valkey', () => valKey);