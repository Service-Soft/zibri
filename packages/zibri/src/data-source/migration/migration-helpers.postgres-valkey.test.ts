import { afterAll, beforeAll } from 'vitest';

import { MigrationEntity } from './migration-entity.model.ts';
import { Badge, describeMigrationHelpers, Gadget } from './migration-helpers.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Gadget, Badge]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Gadget, Badge]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeMigrationHelpers('postgres', () => {
    const dataSource: PostgresDataSource = inject(postgresDataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});

describeMigrationHelpers('valkey', () => {
    const dataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});