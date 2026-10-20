import { afterAll, beforeAll } from 'vitest';

import { Album, Artist, describeNestedRelations, Track } from './nested-relations.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Artist, Album, Track]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Artist, Album, Track]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, 40000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeNestedRelations(
    'postgres',
    () => inject(postgresDataSourceClass).getRepository(Artist),
    () => inject(postgresDataSourceClass).getRepository(Album),
    () => inject(postgresDataSourceClass).getRepository(Track)
);

describeNestedRelations(
    'valkey',
    () => inject(valKeyDataSourceClass).getRepository(Artist),
    () => inject(valKeyDataSourceClass).getRepository(Album),
    () => inject(valKeyDataSourceClass).getRepository(Track)
);