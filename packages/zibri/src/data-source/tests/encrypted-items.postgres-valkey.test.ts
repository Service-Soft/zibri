import { afterAll, beforeAll } from '@jest/globals';

import { describeEncryptedItems, Vault } from './encrypted-items.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Vault]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Vault]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Vault>;
let valKey: Repository<Vault>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Vault);
    valKey = inject(valKeyDataSourceClass).getRepository(Vault);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeEncryptedItems('postgres', () => postgres);

describeEncryptedItems('valkey', () => valKey);