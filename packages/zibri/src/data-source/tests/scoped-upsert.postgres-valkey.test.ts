import { afterAll, beforeAll } from 'vitest';

import { describeScopedUpsert, Pass } from './scoped-upsert.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Pass]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Pass]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Pass>;
let valKey: Repository<Pass>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Pass);
    valKey = inject(valKeyDataSourceClass).getRepository(Pass);
}, 45000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeScopedUpsert('postgres', () => postgres);

describeScopedUpsert('valkey', () => valKey);