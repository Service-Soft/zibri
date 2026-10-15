import { afterAll, beforeAll } from '@jest/globals';

import { describeUuidValues, UuidItem, UuidOwner, UuidValueRepositories } from './uuid-values.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

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